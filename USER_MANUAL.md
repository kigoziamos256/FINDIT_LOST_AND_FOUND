# 📖 FindIt — User Manual

## 1. What is FindIt?

FindIt is a community notice board for lost and found items. Anyone can post a report, browse what others have posted, and claim items that belong to them. Behind the scenes, a background worker scans every new post and automatically suggests matches between lost and found reports — you don't have to refresh or wait.

---

## 2. Creating an account

1. Open the site and click **Sign up**.
2. Enter your name, email and a password (at least 8 characters).
3. Click **Sign up** — you're logged in immediately.

> **Note for admins:** the very first person to register becomes the **admin**. You will see extra buttons in the **Manage claims** page. If you need to demo the admin role, register first; then register a second account with a different email for the claimant side.

---

## 3. Reporting an item

1. Click **Report** in the top bar.
2. Choose **😟 I lost something** or **🎉 I found something**.
3. Fill in:
   - **Title** — short, distinctive (e.g. *"Blue Nike backpack with white stripe"*).
   - **Description** — colour, marks, contents, any detail that would distinguish it.
   - **Category** — pick one (used for matching).
   - **Location** — where it was lost or found.
   - **Photo** — optional, max 5 MB.
4. Click **Submit report**. You're taken to the item's page immediately.

Within a few seconds the background worker scans other reports and, if it finds a strong match, a card appears under **🔗 Possible matches**. Both you and the other reporter get a notification.

---

## 4. Browsing and searching

On the **Browse** page you can:
- Filter by **All / Lost / Found** with the tab switcher.
- Filter by **category** in the dropdown.
- Type in the **search box** — it matches titles and descriptions and updates after a short delay.

Click any card to see the full details, including matches and the claim button.

---

## 5. Claiming a found item

1. Open the **found item's** page.
2. Click **Claim this item**. (You cannot claim your own found item.)
3. The item's status becomes **CLAIM_PENDING** and the person who found it is notified.

---

## 6. Approving or rejecting claims (admin)

1. Click **Manage claims** in the top bar (visible only to the admin).
2. Each pending claim shows the item title, who's claiming it, and a green **✓ verified match** badge if the claimant already has a *lost* report that matched this *found* item.
3. Click **Approve** or **Reject**.
   - **Approve** → the item is marked **RESOLVED**, all other pending claims for that item are rejected, the claimant is notified.
   - **Reject** → the item goes back to **OPEN**, so someone else can claim it.

---

## 7. Notifications

Click the **🔔** icon in the top bar. You'll see match alerts, claim decisions and other events. Unread notifications are highlighted. Use **Mark all as read** to clear them.

---

## 8. What if something goes wrong?

- **"Invalid or expired token"** — this is normal after 15 minutes. The app silently refreshes your session. If you see it again, log in again.
- **"Item is CLAIM_PENDING — cannot claim right now"** — someone else already claimed it and an admin is reviewing. Check back after the admin decides.
- **Slow first load on Render free tier** — the service sleeps after 15 min. The first request wakes it up (~30 s). Subsequent requests are fast.

---

## 9. Privacy & data

- Passwords are hashed with bcrypt and never stored in plain text.
- Emails are only visible to you and to the admin (in the claims view).
- Photos are stored as data URLs in the database (max 5 MB). In a production system this would use presigned S3 uploads — see the REPORT for details.
