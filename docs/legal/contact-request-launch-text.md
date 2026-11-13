# Contact requests: wording for approval

Status: **draft, not approved.** Contact requests stay off: `CONTACT_REQUESTS_ENABLED`
is `false` and `portal.guest_contact` is safety-blocked. Nothing here is published
until the owner approves it and the Privacy Notice is re-issued with it. The live
[Privacy Notice](privacy-notice.md) keeps saying contact requests are disabled,
which is true today.

The strings below are the exact text held in
`src/contexts/guest/page/ui/contact-request.tsx` (guest) and
`src/contexts/guest/contact-requests/ui/contact-request.tsx` (manager). Approval
of a string approves it as written. The privacy check in
[obligation-checks.md](../operations/obligation-checks.md) compares the three texts
against this file.

## 1. Privacy Notice replacements

### Section 1 (amend the Guest definition, then add after the sentence on Guest private ratings and feedback)

> Guests — people who open a published Portal and may submit a private rating,
> optional private feedback or contact details to be followed up on, or choose a
> destination link.
>
> Contact details a Guest chooses to share so a manager can follow up on their
> feedback are processed on the Guest's consent.

### Section 2 (replaces the paragraph beginning "Contact Request is a separate controlled capability")

> Contact requests are optional. On a Portal that offers them, a Guest who has left
> private feedback may share an email address and, if they like, a name, and tick a
> separate box to agree that the property may contact them about that feedback.
> Sharing is never required to rate or to leave feedback. Contact requests are
> switched on Portal by Portal, never for a Property as a whole, and a Portal offers
> them only when its published version says so. The email address and name are stored
> encrypted, apart from the rating and feedback. No phone number is collected. Guest
> media submission is unavailable.

### Section 3 (add to the list of purposes)

> - follow up with a Guest on their own private feedback, only when that Guest has
>   shared an email address for it and agreed by ticking the contact box. The legal
>   basis is the Guest's consent, which can be withdrawn as section 7 describes.
>   The details are used for nothing else and Reputation Key sends the Guest no
>   message;

### Section 4 (replaces the bullet beginning "Portal private feedback and Portal workflow notifications are limited")

> - Portal workflow notifications go to the current responsible managers assigned
>   to that Portal. Account administrators receive them only when a Portal has no
>   eligible responsible manager. A creator is assigned initially when eligible;
>   creation is not permanent exclusive ownership. Account administrators, who are
>   the owners with Organization-wide access, and the property managers assigned to
>   the Property can open a Portal's private feedback. Of those, only the account
>   administrators, the Portal's creator while they remain a property manager with
>   access to the Property, and its current responsible managers can reveal contact
>   details a Guest shared with it. Contact details are hidden until someone reveals
>   them. Every reveal records the person's user id, the time, the purpose and why
>   they had access.

### Section 6 (replaces "Contact Requests are disabled;")

> - Contact requests, where a Portal offers them: the email address and name are
>   hidden from managers 30 days after submission and erased within a day after that
>   by a daily job, or at once when the Guest withdraws. The request record (its
>   time, status and the Portal version it was made under) and the log of reveals
>   (user id, time, purpose and basis) hold no email address or name. They are kept
>   until the response they belong to is deleted. The 24-month deletion of a response
>   runs only when scheduled retention is active, and it is not active yet, so
>   enforcement of that rule has not started;

### Section 7 (replaces "Contact Request remains disabled until its separate consent and withdrawal contract is accepted.")

> - A Guest who shared contact details can withdraw them on the page while it stays
>   open and the 24-hour session lasts. Withdrawal erases the email address and name.
>   Otherwise they are hidden 30 days after submission and erased within a day after.
>   After the session has ended, write to the address below: Reputation Key can erase
>   the whole response, which removes the email address and name with it. It cannot
>   look a response up by email address, because the address is kept only encrypted.

## 2. Strings the owner approves

### Guest (`CONTACT_REQUEST_COPY`)

| Key                          | Text                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| heading                      | Want the property to get back to you about this?                                                                                                                                                                                                                                                                                                                  |
| body                         | Share your email and, if you like, your name. Only managers of this property who can see your feedback can read it, and only to follow up on it. It is hidden after 30 days and erased within a day after that. You can withdraw it here while this page is open and your session lasts, up to 24 hours; after that, use the contact route in the Privacy Notice. |
| emailLabel                   | Email                                                                                                                                                                                                                                                                                                                                                             |
| nameLabel                    | Name (optional)                                                                                                                                                                                                                                                                                                                                                   |
| consentLabel (checkbox)      | I agree the property may contact me about this feedback.                                                                                                                                                                                                                                                                                                          |
| send (button)                | Share my contact details                                                                                                                                                                                                                                                                                                                                          |
| sending                      | Sending…                                                                                                                                                                                                                                                                                                                                                          |
| emailRequired                | Enter an email address the property can reach you on.                                                                                                                                                                                                                                                                                                             |
| consentRequired              | Tick the box to share your contact details.                                                                                                                                                                                                                                                                                                                       |
| sendFailed                   | We could not send your details. Please try again.                                                                                                                                                                                                                                                                                                                 |
| sent (after sending)         | Thank you. The property will get back to you about your feedback. You can withdraw your details here for up to 24 hours, while this page stays open.                                                                                                                                                                                                              |
| withdraw (button)            | Withdraw my contact details                                                                                                                                                                                                                                                                                                                                       |
| withdrawing                  | Withdrawing…                                                                                                                                                                                                                                                                                                                                                      |
| withdrawFailed               | We could not withdraw your details. Please try again.                                                                                                                                                                                                                                                                                                             |
| withdrawn                    | Your contact details were deleted.                                                                                                                                                                                                                                                                                                                                |
| honeypotLabel (hidden field) | Website                                                                                                                                                                                                                                                                                                                                                           |

### Manager (`MANAGER_CONTACT_REQUEST_COPY`)

| Key                           | Text                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| title                         | This guest asked to be contacted                                                                                                                                                                                                                                                                                                                                                                                                                            |
| body                          | Details are hidden until you reveal them. Each reveal records your user id, the time, the purpose and why you had access. Account admins are organization owners with organization-wide access; other managers see requests only for Portals they created or manage. Use the details only to answer this feedback. They are hidden after 30 days and erased within a day after; the request record and reveal log stay after the email and name are erased. |
| reveal (button)               | Reveal contact                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| revealing                     | Revealing…                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| revealFailed (failure line)   | The contact details could not be shown. They may have been withdrawn or expired.                                                                                                                                                                                                                                                                                                                                                                            |
| email                         | Email                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| hiddenLabel (screen reader)   | Hidden contact details                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| revealedLabel (screen reader) | Contact details                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| name                          | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 3. Participation Agreement replacements

Three places in the Participation Agreement change.

### Private feedback access (replaces the paragraph beginning "Portal private feedback is limited to current managers")

> Portal workflow notices go to the current managers assigned responsibility for
> that Portal; account administrators receive them only in the explicit unowned
> recovery state, and notices do not fan out to every Property Manager. Account
> administrators and the property managers assigned to the Property can open a
> Portal's private feedback. The creator is assigned initially when eligible, but
> creation is not permanent exclusive ownership.

### Contact requests (replaces the two sentences "Contact Request remains unavailable until its separate release and privacy requirements are met; if activated, it is email-only.")

The sentence after it, "Phone collection and Guest media remain outside the beta.",
stays as it is and is not repeated here.

> Contact requests are optional. On a Portal that offers them, a Guest who has left
> private feedback may share an email address and, if they like, a name, and tick a
> separate box to agree that the property may contact them about that feedback.
> Contact requests are switched on Portal by Portal, never for a Property as a
> whole, and a Portal offers them only when its published version says so.

### List of capabilities

"Contact Request, only after its separate privacy/handling gate closes" becomes
"Contact requests, only on a Portal that offers them and after the Privacy Notice
describing them is in force".

## 3a. Change note for the next Privacy Notice version

> This version describes contact requests, which a Guest may use to share an email
> address and an optional name so a manager can follow up on their private
> feedback (sections 1 to 4, 6 and 7). It also corrects section 4: the line in
> version 3.3 that Portal private feedback stays limited to responsible managers
> is replaced. Account administrators and the property managers assigned to the
> Property can open a Portal's private feedback; workflow notices still go to the
> current responsible managers, with account administrators as the fallback when
> none is eligible.

## 4. Which text carries which point

| Point                                                                | Guest copy | Manager text | Privacy Notice   |
| -------------------------------------------------------------------- | ---------- | ------------ | ---------------- |
| Hidden after 30 days, erased within a day after                      | body       | body         | sections 6 and 7 |
| Withdrawal only while the page is open and the 24-hour session lasts | body, sent | not stated   | section 7        |
| Account admins are organization owners with organization-wide access | not stated | body         | section 4        |
| A reveal records user id, time, purpose and basis                    | not stated | body         | section 4        |
| Request record and reveal log outlive the erased email and name      | not stated | body         | section 6        |
| How long the request record and reveal log are kept                  | not stated | not stated   | section 6        |

The guest copy is not asked to carry the last three points; the manager text and
the Notice are.
