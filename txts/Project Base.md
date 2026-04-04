# Online Voting Platform — Project Base

---

## 1. Registration & Login

### Register — Create Unified Account

- **Inputs:** Mobile No. or Email _(required)_, First Name, Middle Name, Last Name _(required)_, State, Country
- Register button enabled only when all required fields are filled
- OTP verification required before account is created
- A `pid` (platform identity) is assigned to the account upon registration

### Login

Login screen presents an **Identity Type** selector with three options:

| Identity Type   | Required Inputs          |
|-----------------|--------------------------|
| Government      | EPIC ID                  |
| Other ORG       | ORG ID + ORG Personal ID |
| Unified Account | Mobile or Email          |

**OTP Flow:**

- Government / ORG login: OTP sent to the mobile/email registered by the person who enrolled that identity in the org
- Unified Account login: OTP sent to the provided mobile or email

**Notes:**

- The Unified Account option also serves as the entry point for people whose org is not yet registered — they register
  via Unified Account, then register their org from the dashboard
- For Government / ORG logins, the provided IDs are validated against the existing registered entity in the DB

**DB Notes:**

- `pid` is used for unified identity mapping
- `pid` is assigned only when a person registers via Unified Account, or later links a mobile/email to an existing
  org/gov identity via Manage Account

---

## 2. User Dashboard

**Default view:** Events

**Side Menu Options:**

- Manage Account
- Manage Organizations
- Events _(default)_
- Manage My Events
- Identity Wallet

---

### Manage Account

- Edit name
- Add or update mobile number

---

### Manage Organizations

Visible only to users with an Organizer role.

#### Register Organization

- Input: Organization Name
- Input: Submitter's own Organization Personal ID
- Input: Participant list — via table input, CSV file import, or paste CSV text
    - Participant list fields: Organization Personal ID, Email/Mobile
- ORG ID is auto-generated as 3 letters from the org name + 4 digits
    - Option to specify a preferred ORG ID (3 letters + 4 digits)
- On submission:
    - Participant list is populated with: personal IDs, email/mobile, role (default: `voter`), scope (default: root
      scope within the org i.e scope of the org with no parent)
    - The submitter receives `voter + organizer` roles at scope level `0`
    - The ORG ID is bound to the submitter's account

#### Manage Organization

- View all organizations where the user has an Organizer role
- Manage participant list
- Assign roles to participants

#### Scope Management

Scope is a **visibility and access control layer** within an org, structured as a tree. Events created at a scope are
visible **downward** through the tree by default (not upward unless overridden at event creation).

**Scope is a fixed tree — nodes are not moved.** Instead, participants are transferred between scope nodes as needed.
This keeps the tree structure stable and avoids expensive subtree restructuring operations.

**DB Implementation:**

- Scope tree stored in `org_scope` table
- A `scope_closure` table maintains all ancestor–descendant pairs with depth, enabling O(1) descendant/ancestor lookups
  in place of recursive CTEs
- Closure table is maintained automatically via triggers on `org_scope` (insert, delete)
- Node deletion is restricted: a scope node cannot be deleted if it has child nodes or assigned members — the organizer
  must reassign/transfer members and delete child nodes first

**Scope Management UI:**

- Interactive tree workspace — supported operations:
    - Add child node
    - Rename node
    - Delete node _(only if empty — no children, no assigned members)_
- Participant list panel on the left with search and filter by scope/role
- Operations on selected participants: change role, change scope (transfer), correct ID
- Add Participant option at the bottom — via table or CSV (fields: ID, email/mobile, role, scope)

**Access Boundaries:**

- An organizer can only view and edit participants within their own scope or below — not above
- An organizer can only manage scope nodes within their own scope subtree

---

### Events

Displays all events visible to the user across their identities, based on scope visibility rules. Divided into:

- **Active — Yet to Vote**
- **Voted**
- **Completed**

Clicking an event opens its detail view:

- Event description
- Candidate information
- Voter selects a candidate → Confirm → Submit

---

### Manage My Events

Create events within orgs and scopes where the user has an Organizer role.

**Event Creation Flow:**

1. Select which identity (org + scope) to create the event under
2. Input candidate data
3. Set event start and end times
4. Add description details

**Advanced Options:**

- Enable / disable live vote data visibility
- Restrict visibility to current scope only (do not propagate downward)

---

### Identity Wallet

- Displays all identities bound to the account
- If mobile/email is not linked: shows only the org or gov identity used to log in, with a prompt to create a Unified
  Account to unlock the full wallet
- For users with a Unified Account: shows an **Add Identity** option that opens a login-style popup — upon OTP
  verification, the identity is bound to the account

---

## 3. Database — Key Design Decisions

### Scope Tree & Visibility

- Scope forms a **tree per organization**, stored in `org_scope`
- Visibility propagates **downward** by default; upward propagation is an optional per-event flag
- Scope lookup performance is handled by a `scope_closure` table (closure table pattern)

### Scope Closure Table

```sql
scope_closure
(ancestor_id, descendant_id, depth)
```

- Self-reference rows (depth = 0) exist for every node
- Maintained by `AFTER INSERT` trigger on `org_scope`
- Cascade-deleted automatically via FK when a scope node is deleted
- No `UPDATE` trigger needed — node reattachment is not supported by design

### Role & Scope Separation

- `member_roles` holds both `scope_id` and role flags (`is_organizer`, `is_voter`)
- One scope per member (single `scope_id` in `member_roles`) — accepted constraint
- A trigger (`trg_check_member_scope_org`) enforces that a member's assigned `scope_id` belongs to the same org as the
  member

### Visibility Logic

- `get_visible_events(orgid, scope_id)` in the DB is the **single source of truth** for event visibility
- The backend service calls this function directly — visibility logic is not re-derived in the application layer

### Scope Node Deletion Guard

A `BEFORE DELETE` trigger on `org_scope` prevents deletion if:

- The node has child scope nodes
- The node has members assigned to it

The organizer must transfer members and remove child nodes before a node can be deleted.