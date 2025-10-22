# Rybn - Complete Project Plan

## Project Overview

**Rybn** is a full-stack web application for coordinating gift shopping across multiple groups (families, friends, work groups) with granular privacy controls, wishlists, secret santa coordination, and private group messaging. Built with Next.js 15+, Supabase, Resend, and Monday.com's Vibe design system.

**Tagline:** "Tied together" / "Gift giving, beautifully wrapped"

## Technology Stack

### Core Technologies
- **Next.js 15+** (App Router) - Latest React 19 features
- **TypeScript 5.3+** - Type safety and better DX
- **Supabase** - PostgreSQL database, authentication, real-time, and storage
- **Resend** - Email notifications and invites
- **Monday.com Vibe** - Design system and components
- **Vercel** - Hosting and deployment

### Key Libraries
- **@vibe/core** - Monday.com's component library
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **Tanstack Query v5** - Server state management
- **date-fns** - Date manipulation
- **next-themes** - Dark/light mode support

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   Vercel Platform                    │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │           Next.js 15 App Router              │   │
│  │         React 19 + TypeScript + Vibe         │   │
│  │            Light/Dark Theme Support          │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                 │
│                    │ API Routes                     │
│                    │                                 │
└────────────────────┼─────────────────────────────────┘
                     │
        ┌────────────┼────────────┬─────────────┐
        │            │            │             │
┌───────▼──────────┐ │  ┌─────────▼──────┐   ┌─▼────────┐
│    Supabase      │ │  │    Resend      │   │ MCP      │
│  - PostgreSQL    │ │  │  Email Service │   │ Server   │
│  - Auth          │ │  │                │   │ (Claude) │
│  - Realtime      │ │  └────────────────┘   └──────────┘
│  - Storage       │ │
│  - Edge Functions│ │
└──────────────────┘ │
```

## Database Schema (Supabase)

### Extended Schema with Privacy Controls

```sql
-- Privacy levels enum
CREATE TYPE privacy_level AS ENUM ('private', 'group', 'friends', 'family', 'public');
CREATE TYPE group_type AS ENUM ('family', 'friends', 'work', 'custom');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

-- Users table (managed by Supabase Auth)
-- Uses Supabase's auth.users table

-- User profiles extension
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Groups (replaces families)
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type group_type NOT NULL DEFAULT 'custom',
  invite_code TEXT UNIQUE NOT NULL,
  settings JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Group members
CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- Profile categories with privacy settings
CREATE TABLE profile_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- 'sizes', 'preferences', 'vehicles', 'personal'
  field_name TEXT NOT NULL,
  field_value TEXT,
  privacy_settings JSONB DEFAULT '{}', -- {group_id: privacy_level}
  default_privacy privacy_level DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, field_name)
);

-- Wishlist items with privacy
CREATE TABLE wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  price DECIMAL(10, 2),
  image_url TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'must-have')),
  category TEXT,
  privacy_settings JSONB DEFAULT '{}', -- {group_id: privacy_level}
  default_privacy privacy_level DEFAULT 'group',
  claimed_by UUID REFERENCES auth.users(id),
  claimed_at TIMESTAMPTZ,
  purchased BOOLEAN DEFAULT FALSE,
  purchased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gift coordination groups
CREATE TABLE gift_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_user_id UUID REFERENCES auth.users(id),
  target_amount DECIMAL(10, 2),
  current_amount DECIMAL(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gift group members
CREATE TABLE gift_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_group_id UUID REFERENCES gift_groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contribution_amount DECIMAL(10, 2),
  has_paid BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gift_group_id, user_id)
);

-- Messages for gift groups
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_group_id UUID REFERENCES gift_groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  attachment_url TEXT,
  is_edited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Secret Santa events
CREATE TABLE secret_santa_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  budget_min DECIMAL(10, 2),
  budget_max DECIMAL(10, 2),
  exchange_date DATE,
  exchange_location TEXT,
  exchange_details TEXT,
  registration_deadline DATE,
  is_active BOOLEAN DEFAULT TRUE,
  assignments_generated BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Secret Santa participants
CREATE TABLE secret_santa_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES secret_santa_events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  opted_in BOOLEAN DEFAULT TRUE,
  assigned_to UUID REFERENCES auth.users(id),
  wishlist_shared BOOLEAN DEFAULT FALSE,
  gift_sent BOOLEAN DEFAULT FALSE,
  gift_received BOOLEAN DEFAULT FALSE,
  notes TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

-- Invitations tracking
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id) NOT NULL,
  accepted BOOLEAN DEFAULT FALSE,
  accepted_at TIMESTAMPTZ,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security Policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_santa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies (examples)
CREATE POLICY "Users can view their own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can view groups they're members of"
  ON groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
    )
  );

-- Privacy-aware profile viewing
CREATE POLICY "Users can view profile info based on privacy settings"
  ON profile_info FOR SELECT
  USING (
    user_id = auth.uid() OR
    -- Complex privacy logic here based on group membership and privacy settings
    EXISTS (
      SELECT 1 FROM group_members gm1
      JOIN group_members gm2 ON gm1.group_id = gm2.group_id
      WHERE gm1.user_id = auth.uid()
      AND gm2.user_id = profile_info.user_id
      AND (
        profile_info.privacy_settings->>(gm1.group_id::text) IN ('group', 'friends', 'family', 'public')
        OR profile_info.default_privacy IN ('group', 'friends', 'family', 'public')
      )
    )
  );
```

## Project Structure

```
rybn/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── register/
│   │   │   └── page.tsx
│   │   ├── verify-email/
│   │   │   └── page.tsx
│   │   └── accept-invite/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx           # Dashboard layout with Vibe components
│   │   ├── page.tsx             # Dashboard home
│   │   ├── groups/
│   │   │   ├── page.tsx         # Groups list
│   │   │   ├── create/
│   │   │   ├── [groupId]/
│   │   │   │   ├── page.tsx     # Group detail
│   │   │   │   ├── members/
│   │   │   │   ├── settings/
│   │   │   │   └── secret-santa/
│   │   ├── profile/
│   │   │   ├── page.tsx         # User profile
│   │   │   ├── edit/
│   │   │   │   └── page.tsx     # Edit with privacy controls
│   │   │   └── [userId]/
│   │   │       └── page.tsx     # View other user's profile
│   │   ├── wishlist/
│   │   │   ├── page.tsx         # User's wishlist
│   │   │   ├── add/
│   │   │   └── [userId]/        # View other's wishlist
│   │   ├── gifts/
│   │   │   ├── page.tsx         # Gift coordination groups
│   │   │   ├── create/
│   │   │   └── [giftGroupId]/
│   │   │       └── chat/        # Private group chat
│   │   └── secret-santa/
│   │       ├── page.tsx         # Active Secret Santa events
│   │       └── [eventId]/
│   ├── api/
│   │   ├── auth/                # NextAuth or Supabase Auth handlers
│   │   ├── groups/
│   │   ├── profile/
│   │   ├── wishlist/
│   │   ├── gifts/
│   │   ├── messages/
│   │   ├── secret-santa/
│   │   └── invites/
│   └── layout.tsx               # Root layout with theme provider
├── components/
│   ├── vibe/                    # Vibe component wrappers
│   │   ├── ThemeProvider.tsx    # Light/Dark theme support
│   │   ├── Button.tsx
│   │   ├── TextField.tsx
│   │   ├── Dialog.tsx
│   │   └── ...
│   ├── profile/
│   │   ├── ProfileForm/
│   │   │   ├── SizesSection.tsx
│   │   │   ├── PreferencesSection.tsx
│   │   │   ├── VehiclesSection.tsx
│   │   │   └── PrivacyControls.tsx
│   │   └── ProfileCard/
│   ├── wishlist/
│   │   ├── WishlistItem/
│   │   ├── WishlistGrid/
│   │   └── PrivacySelector/
│   ├── groups/
│   │   ├── GroupCard/
│   │   ├── MemberList/
│   │   └── InviteModal/
│   ├── gifts/
│   │   ├── GiftGroupCard/
│   │   ├── ContributionTracker/
│   │   └── ChatWindow/
│   └── secret-santa/
│       ├── EventCard/
│       ├── ParticipantList/
│       ├── AssignmentView/
│       └── ScheduleDisplay/
├── lib/
│   ├── supabase/
│   │   ├── client.ts            # Browser client
│   │   ├── server.ts            # Server client
│   │   ├── middleware.ts        # Auth middleware
│   │   └── types.ts             # Generated types
│   ├── resend/
│   │   ├── client.ts
│   │   └── templates/           # Email templates
│   ├── vibe/
│   │   ├── config.ts            # Vibe configuration
│   │   └── theme.ts             # Theme customization
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── usePrivacy.ts        # Privacy level hooks
│   │   ├── useRealtime.ts       # Supabase realtime
│   │   └── useTheme.ts
│   └── utils/
│       ├── privacy.ts           # Privacy helper functions
│       ├── secret-santa.ts      # Assignment algorithm
│       └── validators.ts
├── types/
│   ├── database.ts              # Supabase generated types
│   ├── privacy.ts               # Privacy types
│   └── vibe.d.ts                # Vibe type extensions
├── styles/
│   ├── globals.css              # Global styles
│   └── vibe-overrides.css       # Vibe customizations
├── public/
├── .env.local
├── next.config.js
├── package.json
└── tsconfig.json
```

## Implementation Phases

### Phase 1: Foundation & Authentication (Week 1)

#### 1.1 Project Setup
- [ ] Initialize Next.js 15 with TypeScript
- [ ] Configure Supabase project
- [ ] Set up Monday.com Vibe design system
- [ ] Configure MCP server for Claude integration
- [ ] Implement theme provider (light/dark mode)
- [ ] Set up Resend for emails

#### 1.2 Authentication Flow
- [ ] Supabase Auth configuration
- [ ] Registration with email verification
- [ ] Login/logout functionality
- [ ] Password reset flow
- [ ] Protected route middleware
- [ ] User profile creation on signup

#### 1.3 Vibe Component Setup
```typescript
// Example Vibe setup with theme support
import { ThemeProvider } from "@vibe/core";
import { useTheme } from "next-themes";

export function VibeThemeProvider({ children }) {
  const { theme } = useTheme();
  
  return (
    <ThemeProvider 
      themeConfig={{
        name: theme === 'dark' ? 'dark' : 'light',
        // Custom theme overrides
      }}
    >
      {children}
    </ThemeProvider>
  );
}
```

### Phase 2: Groups & Invitations (Week 2)

#### 2.1 Group Management
- [ ] Create group with type selection
- [ ] Generate unique invite codes
- [ ] Group settings page
- [ ] Member management with roles
- [ ] Leave/delete group functionality

#### 2.2 Invitation System
- [ ] Send email invitations via Resend
- [ ] Accept invite flow (registered/unregistered users)
- [ ] Invitation tracking
- [ ] Automatic group join after registration
- [ ] Bulk invite functionality

```typescript
// Invitation flow example
async function handleInvite(email: string, groupId: string) {
  // Check if user exists
  const { data: existingUser } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .single();

  if (existingUser) {
    // Send login & accept invite email
    await resend.emails.send({
      from: 'Rybn <hello@rybn.app>',
      to: email,
      subject: 'You\'re invited to join a group on Rybn!',
      react: <ExistingUserInviteEmail groupId={groupId} />
    });
  } else {
    // Send registration & auto-accept invite email
    await resend.emails.send({
      from: 'Rybn <hello@rybn.app>',
      to: email,
      subject: 'You\'re invited to Rybn - coordinate gifts together!',
      react: <NewUserInviteEmail groupId={groupId} />
    });
  }
}
```

### Phase 3: Profile System with Privacy Controls (Week 3)

#### 3.1 Profile Categories
- [ ] Sizes section (shoe, clothing, ring, etc.)
- [ ] Preferences (colors, brands, styles)
- [ ] Vehicles (make, model, year)
- [ ] Personal info (hobbies, interests, dietary)
- [ ] Important dates (birthday, anniversary)

#### 3.2 Privacy Controls
- [ ] Per-field privacy settings
- [ ] Group-specific privacy levels
- [ ] Default privacy preferences
- [ ] Privacy preview (see as other user)
- [ ] Bulk privacy updates

```typescript
// Privacy control component
<PrivacySelector
  field="shoe_size"
  value={privacy.shoe_size}
  onChange={(level) => updatePrivacy('shoe_size', level)}
  groupOverrides={groupPrivacyOverrides}
/>
```

### Phase 4: Wishlist with Privacy (Week 4)

#### 4.1 Wishlist Management
- [ ] Add/edit/delete items
- [ ] URL metadata scraping
- [ ] Image upload to Supabase Storage
- [ ] Priority levels
- [ ] Categories/tags

#### 4.2 Wishlist Privacy & Sharing
- [ ] Per-item privacy controls
- [ ] Group-specific visibility
- [ ] Claim items (hidden from owner)
- [ ] Purchase tracking
- [ ] Share wishlist link

### Phase 5: Gift Coordination & Chat (Week 5)

#### 5.1 Gift Groups
- [ ] Create gift coordination group
- [ ] Invite specific members
- [ ] Set target amount
- [ ] Track contributions
- [ ] Mark as complete

#### 5.2 Real-time Chat
- [ ] Supabase Realtime setup
- [ ] Message sending/receiving
- [ ] Typing indicators
- [ ] Read receipts
- [ ] File attachments
- [ ] Message history
- [ ] Push notifications setup

```typescript
// Real-time chat setup
const channel = supabase.channel(`gift-group-${groupId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `gift_group_id=eq.${groupId}`
  }, (payload) => {
    // Handle new message
    addMessage(payload.new);
  })
  .subscribe();
```

### Phase 6: Secret Santa Coordination (Week 6)

#### 6.1 Event Management
- [ ] Create Secret Santa event
- [ ] Set budget range
- [ ] Schedule exchange details
- [ ] Registration deadline
- [ ] Opt-in/opt-out system

#### 6.2 Assignment & Coordination
- [ ] Assignment algorithm (with exclusions)
- [ ] Reveal assignments to participants
- [ ] Wishlist sharing for assigned person
- [ ] Exchange reminders
- [ ] Completion tracking

```typescript
// Secret Santa assignment algorithm
function assignSecretSanta(participants: User[], exclusions: Map<string, string[]>) {
  const assignments = new Map<string, string>();
  const available = [...participants];
  
  for (const giver of participants) {
    const excluded = exclusions.get(giver.id) || [];
    const validTargets = available.filter(
      t => t.id !== giver.id && !excluded.includes(t.id)
    );
    
    if (validTargets.length === 0) {
      // Restart with different seed
      return assignSecretSanta(participants, exclusions);
    }
    
    const target = validTargets[Math.floor(Math.random() * validTargets.length)];
    assignments.set(giver.id, target.id);
    available.splice(available.indexOf(target), 1);
  }
  
  return assignments;
}
```

### Phase 7: Vibe Design System Integration (Week 7)

#### 7.1 Component Library
- [ ] Create Vibe component wrappers
- [ ] Implement custom theme configuration
- [ ] Build composite components
- [ ] Create loading states with Vibe
- [ ] Implement toast notifications

#### 7.2 Theme Support
- [ ] Light/dark mode toggle
- [ ] System preference detection
- [ ] Persist theme preference
- [ ] Smooth theme transitions
- [ ] Custom color schemes per group

### Phase 8: Testing & Deployment (Week 8)

#### 8.1 Testing
- [ ] Unit tests for utilities
- [ ] Component testing
- [ ] E2E tests for critical flows
- [ ] Privacy control testing
- [ ] Real-time functionality tests

#### 8.2 Deployment
- [ ] Configure Vercel project
- [ ] Set up environment variables
- [ ] Configure Supabase production
- [ ] Set up Resend domain
- [ ] Deploy and test
- [ ] Set up monitoring

## Key Features Implementation

### Privacy Control System

```typescript
// Privacy control implementation
interface PrivacySettings {
  default: PrivacyLevel;
  groupOverrides: Record<string, PrivacyLevel>;
}

enum PrivacyLevel {
  Private = 'private',
  Group = 'group',
  Friends = 'friends',
  Family = 'family',
  Public = 'public'
}

function canViewField(
  fieldPrivacy: PrivacySettings,
  viewerGroups: GroupMembership[],
  fieldOwner: string,
  viewer: string
): boolean {
  if (fieldOwner === viewer) return true;
  
  // Check group-specific overrides
  for (const group of viewerGroups) {
    const override = fieldPrivacy.groupOverrides[group.id];
    if (override && isPrivacyLevelSufficient(override, group.type)) {
      return true;
    }
  }
  
  // Check default privacy
  return isPrivacyLevelSufficient(fieldPrivacy.default, viewerGroups);
}
```

### MCP Server Integration

```typescript
// MCP server configuration for Claude with Rybn
import { MCPClient } from '@mcp/client';

const mcpClient = new MCPClient({
  serverUrl: process.env.MCP_SERVER_URL,
  apiKey: process.env.MCP_API_KEY,
});

// Use for AI-powered features in Rybn
async function generateGiftSuggestions(profile: UserProfile) {
  const suggestions = await mcpClient.complete({
    prompt: `Based on this Rybn user profile, suggest thoughtful gift ideas that would tie the group together: ${JSON.stringify(profile)}`,
    model: 'claude-3-opus',
  });
  return suggestions;
}
```

### Vibe Component Examples

```tsx
// Using Vibe components with theme support
import { 
  Button, 
  TextField, 
  Dialog, 
  Dropdown,
  Avatar,
  List,
  ListItem 
} from "@vibe/core";

function GroupMemberList({ members }) {
  return (
    <List>
      {members.map(member => (
        <ListItem key={member.id}>
          <Avatar src={member.avatar} />
          <div>{member.name}</div>
          <Dropdown>
            <Dropdown.Item>View Profile</Dropdown.Item>
            <Dropdown.Item>Send Message</Dropdown.Item>
            <Dropdown.Item>Remove</Dropdown.Item>
          </Dropdown>
        </ListItem>
      ))}
    </List>
  );
}
```

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Resend
RESEND_API_KEY=re_xxx

# App
NEXT_PUBLIC_APP_NAME=Rybn
NEXT_PUBLIC_APP_URL=https://rybn.app
NEXT_PUBLIC_APP_TAGLINE="Tied together"

# Email
EMAIL_FROM_NAME=Rybn
EMAIL_FROM_ADDRESS=hello@rybn.app
EMAIL_SUPPORT=support@rybn.app

# MCP Server (Claude integration)
MCP_SERVER_URL=xxx
MCP_API_KEY=xxx

# Theme
NEXT_PUBLIC_DEFAULT_THEME=light
```

## Supabase Configuration

### Edge Functions
```typescript
// supabase/functions/send-invite/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { Resend } from 'npm:resend@latest'

const resend = new Resend(Deno.env.get('RESEND_API_KEY'))

serve(async (req) => {
  const { email, groupName, inviteUrl } = await req.json()
  
  const { data, error } = await resend.emails.send({
    from: 'Rybn <hello@rybn.app>',
    to: email,
    subject: `You're invited to ${groupName} on Rybn`,
    react: InviteEmail({ groupName, inviteUrl })
  })
  
  return new Response(JSON.stringify({ data, error }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

### Real-time Subscriptions
```typescript
// Subscribe to messages
supabase
  .channel('messages')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'messages',
    filter: `gift_group_id=eq.${groupId}`
  }, handleMessageChange)
  .subscribe()
```

## Development Workflow with Claude Code

### Effective Prompts for Claude Code

1. **Initial Setup**
```
"Set up a Next.js 15 app called Rybn with TypeScript, Supabase, and Monday.com's Vibe design system. Include theme provider for light/dark mode support. Rybn is a gift coordination app."
```

2. **Privacy System**
```
"Create a privacy control system for Rybn user profile fields with group-specific overrides. Use Supabase RLS policies and React components with Vibe design."
```

3. **Secret Santa Feature**
```
"Implement a Secret Santa coordination system for Rybn with opt-in/out, assignment algorithm, and scheduling. Use Supabase for storage and Resend for notifications."
```

4. **Real-time Chat**
```
"Build a real-time chat system for Rybn using Supabase Realtime for gift coordination groups. Include typing indicators and read receipts with Vibe UI components."
```

5. **Component Development**
```
"Create a reusable ProfileForm component for Rybn with sections for sizes, preferences, and vehicles. Include per-field privacy controls using Vibe components."
```

## Testing Strategy

### Key Test Areas
- Privacy control logic
- Group invitation flow
- Secret Santa assignment algorithm
- Real-time message delivery
- Theme switching
- Authentication flows

### E2E Test Example
```typescript
// tests/invitation-flow.spec.ts
test('new user can register and auto-join group', async ({ page }) => {
  // Start from invitation link
  await page.goto('/accept-invite?token=abc123');
  
  // Should redirect to register
  await expect(page).toHaveURL('/register');
  
  // Complete registration
  await page.fill('[name="email"]', 'newuser@test.com');
  await page.fill('[name="password"]', 'SecurePass123!');
  await page.click('button[type="submit"]');
  
  // Should auto-join group and redirect to dashboard
  await expect(page).toHaveURL('/groups/group-id');
  await expect(page.locator('text=Welcome to Family Group on Rybn')).toBeVisible();
});
```

## Performance Optimizations

- Use Supabase connection pooling
- Implement proper caching strategies
- Optimize images with Next.js Image
- Lazy load group member lists
- Virtual scrolling for large wishlists
- Debounce real-time updates

## Security Considerations

- Implement proper RLS policies in Supabase
- Validate privacy settings on backend
- Sanitize user inputs
- Rate limit API endpoints
- Secure file uploads
- Encrypt sensitive data
- Audit trail for Secret Santa assignments

## Monitoring & Analytics

- Vercel Analytics for performance
- Supabase Dashboard for database
- Resend Dashboard for email delivery
- Custom analytics for feature usage
- Error tracking with Sentry

## Cost Analysis

### Free Tier Limits
- **Supabase**: 500MB database, 1GB storage, 2GB bandwidth
- **Resend**: 100 emails/day, 3000/month
- **Vercel**: Unlimited for personal use
- **Vibe**: Free to use

### Estimated Capacity
- ~200 active groups
- ~1000 total users
- ~5000 wishlist items
- ~100 daily emails
- ~10,000 messages/month

## Notes for Claude Code Implementation

### Priority Order
1. Start with Vibe design system setup and theme provider
2. Implement Supabase auth with proper RLS
3. Build privacy control system early (it affects everything)
4. Create reusable Vibe-based components
5. Add real-time features incrementally
6. Test privacy controls thoroughly

### Key Considerations
- Always use Vibe components for consistency
- Test both light and dark themes
- Ensure privacy controls work across all features
- Make components reusable across group types
- Consider mobile responsiveness with Vibe
- Use Supabase RLS for security, not just frontend checks

This comprehensive plan provides everything needed to build **Prezzie** - your gift coordination app with privacy controls, Secret Santa functionality, and the Monday.com Vibe design system. The app makes gift giving joyful and stress-free for families, friends, and work groups.
