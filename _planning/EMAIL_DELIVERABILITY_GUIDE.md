# Email Deliverability Guide for Rybn

## Changes Made to Code

I've updated your email sending code to improve deliverability:

### ✅ Added Plain Text Versions
All emails now include both HTML and plain text versions, which spam filters prefer.

### ✅ Added Reply-To Headers
All emails now include `replyTo: support@rybn.app` so recipients can respond.

### ✅ Added Email Headers
- `X-Entity-Ref-ID`: Unique identifier for tracking
- `List-Unsubscribe`: Required header for bulk email (highly recommended by Gmail/Outlook)
- `List-Unsubscribe-Post`: One-click unsubscribe support

## Required DNS Configuration

You MUST configure these DNS records in your domain registrar (where you bought rybn.app):

### 1. Resend Email Authentication Records

Log into your Resend dashboard and navigate to **Domains** section. You'll need to add these DNS records:

#### SPF Record (Type: TXT)
```
Name: @
Value: v=spf1 include:_spf.resend.com ~all
```

#### DKIM Records (Type: TXT)
Resend will provide you with 2-3 DKIM records. They look like:
```
Name: resend._domainkey
Value: [Resend will provide this long value]
```

#### DMARC Record (Type: TXT)
```
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:support@rybn.app
```

**Important**: After adding these, wait 24-48 hours for DNS propagation, then verify in Resend dashboard.

### 2. Verify Your Domain in Resend

1. Go to https://resend.com/domains
2. Click "Add Domain"
3. Enter `rybn.app`
4. Copy the DNS records provided
5. Add them to your DNS provider
6. Click "Verify" in Resend (may take up to 48 hours)

## Additional Steps to Avoid Spam

### 3. Warm Up Your Domain

New domains/IPs are automatically suspicious. Start slowly:
- Week 1: Send to 10-20 emails/day
- Week 2: Send to 50-100 emails/day
- Week 3: Send to 200-500 emails/day
- Week 4+: Normal volume

### 4. Monitor Your Sender Reputation

Use these tools to check your domain health:
- https://www.mail-tester.com/ - Send test emails here
- https://mxtoolbox.com/domain/ - Check your DNS records
- https://postmaster.google.com/ - Monitor Gmail delivery (requires verification)

### 5. Best Practices Checklist

- ✅ Use a real reply-to address (support@rybn.app)
- ✅ Include physical address in footer (legal requirement)
- ✅ Include unsubscribe link (now added)
- ✅ Send from a domain you own (@rybn.app not @gmail.com)
- ✅ Avoid spam trigger words in subject lines
- ✅ Keep email-to-HTML ratio balanced (we now send both)
- ✅ Test emails before sending to users

### 6. Content Recommendations

**Avoid these in subject lines:**
- Excessive punctuation (!!!, $$$)
- ALL CAPS
- "FREE", "ACT NOW", "LIMITED TIME"
- Too many emojis

**Good subject line examples:**
- "You're invited to join [Group Name] on Rybn"
- "[Name]'s birthday is coming up"
- "Welcome to Rybn!"

### 7. Create Unsubscribe Page

You'll need to create `/settings/notifications` page (currently referenced but may not exist):

```tsx
// app/(dashboard)/settings/notifications/page.tsx
export default function NotificationsPage() {
  return (
    <div>
      <h1>Email Preferences</h1>
      {/* Add unsubscribe options */}
    </div>
  );
}
```

## Testing Your Configuration

### Quick Test: Use the Test Email API Endpoint

We've created a dedicated API endpoint for easy testing with mail-tester.com:

**Method 1: Using curl (Terminal)**
```bash
# 1. Get your test email from https://www.mail-tester.com/
# 2. Run this command (replace with your test email):
curl -X POST http://localhost:3000/api/test-email \
  -H "Content-Type: application/json" \
  -H "Cookie: your-auth-cookie" \
  -d '{"email":"test-xxxxx@mail-tester.com"}'
```

**Method 2: Using the browser console**
```javascript
// 1. Go to https://www.mail-tester.com/ and copy the test email
// 2. Open your Rybn app in the browser
// 3. Open browser console (F12) and run:
fetch('/api/test-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'test-xxxxx@mail-tester.com' })
}).then(r => r.json()).then(console.log)

// 4. Go back to mail-tester.com and check your score
```

**Method 3: Create a simple test page (recommended)**

Create a simple admin page at `app/(dashboard)/admin/test-email/page.tsx` with a form to send test emails easily.

### Manual Testing Steps

### Step 1: Check DNS Records
```bash
# Check SPF
dig TXT rybn.app

# Check DKIM
dig TXT resend._domainkey.rybn.app

# Check DMARC
dig TXT _dmarc.rybn.app
```

### Step 2: Send Test Email
Send a test invite to yourself, then check:
1. Does it arrive in inbox or spam?
2. View email source (usually in "Show original" or similar)
3. Look for "SPF: PASS", "DKIM: PASS", "DMARC: PASS"

### Step 3: Use Mail Tester
1. Go to https://www.mail-tester.com/
2. Get the test email address
3. Use the `/api/test-email` endpoint (see Quick Test above) or send an invite to that address
4. Check your score (aim for 8+/10)

## Expected Timeline

- DNS changes: 1-48 hours to propagate
- Domain warming: 2-4 weeks
- Full reputation: 1-3 months

## Common Issues

### "SPF: FAIL"
- SPF record not added or incorrect
- Multiple SPF records (only one allowed)

### "DKIM: FAIL"
- DKIM records not added or incorrect
- DNS not propagated yet

### Still Going to Spam
- Domain needs more warming time
- Check mail-tester.com score
- Verify all DNS records are passing
- Check email content for spam triggers

## Support Resources

- Resend Docs: https://resend.com/docs
- Resend Status: https://status.resend.com/
- Email Testing: https://www.mail-tester.com/

## Next Steps

1. **Immediately**: Configure DNS records in Resend
2. **Within 24 hours**: Verify domain in Resend dashboard
3. **Start warm-up**: Send test emails to yourself and friends
4. **Monitor**: Use mail-tester.com to check scores
5. **Create**: Unsubscribe/notifications settings page
