# Rybn - Tied Together

Gift giving, beautifully wrapped. A full-stack gift coordination app built with Next.js, Clerk, Supabase, and Monday.com's Vibe design system.

**Domain**: rybn.app

## What's Complete (Phase 1)

**Foundation & Authentication ✓**

- Next.js 15 with TypeScript and App Router
- Monday.com Vibe design system with theme support (light/dark mode)
- Clerk authentication (login, register, Google OAuth)
- Protected routes with middleware
- Resend email integration with templates
- Basic dashboard layout with navigation

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account (for the database and realtime)
- Clerk account (for authentication)
- Resend account (for email)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and fill in your credentials:
   ```bash
   cp .env.example .env.local
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety
- **Clerk** - Authentication
- **Supabase** - Database and real-time
- **Resend** - Email notifications
- **Monday.com Vibe** - Design system and components
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **TanStack Query** - Server state management
- **next-themes** - Theme support
- **Tailwind CSS** - Styling

## Project Structure

```
rybn/
├── app/                        # Next.js app router
│   ├── (auth)/                # Authentication pages
│   │   ├── login/[[...rest]]/ # Clerk <SignIn/> (catch-all: Clerk routes its
│   │   │                      #   own sub-steps under this path)
│   │   ├── register/[[...rest]]/ # Clerk <SignUp/> (catch-all, same reason)
│   │   └── accept-invite/     # Invitation acceptance (hash-routed <SignUp/>)
│   ├── (dashboard)/           # Signed-in pages (the only gate on /admin/*)
│   └── api/                   # API routes
├── components/                # React components
│   └── vibe/                  # Vibe component wrappers
├── lib/                       # Utilities and clients
│   ├── auth/                 # requireAuth + profile provisioning
│   ├── actions/              # Server actions
│   ├── supabase/             # Supabase clients (Clerk-authenticated)
│   ├── resend/               # Email templates
│   └── hooks/                # Custom React hooks
├── proxy.ts                  # clerkMiddleware + protected-route matcher
├── types/                    # TypeScript types
└── _planning/                # Project documentation
```

## Next Steps (From Plan)

See `_planning/rybn_plan.md` for the complete 8-week implementation plan:

- **Phase 2**: Groups & Invitations
- **Phase 3**: Profile System with Privacy Controls
- **Phase 4**: Wishlist with Privacy
- **Phase 5**: Gift Coordination & Chat
- **Phase 6**: Secret Santa Coordination
- **Phase 7**: Advanced Vibe Integration
- **Phase 8**: Testing & Deployment

## License

MIT
