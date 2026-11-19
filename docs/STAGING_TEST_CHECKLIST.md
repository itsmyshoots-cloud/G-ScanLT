# Staging test checklist

Run after the migration is applied and test users are created.

## Authentication and roles
- [ ] Unauthenticated requests cannot read production tables.
- [ ] Operator can sign in and sees only published/completed plans.
- [ ] Operator cannot create or edit plan drafts or change product masters.
- [ ] Supervisor/admin can create drafts and maintain the catalogue.
- [ ] Role is sourced from JWT \`app_metadata\`, never \`user_metadata\`.

## Plan creation and publishing
- [ ] Brand → product → model relationship is enforced by foreign keys.
- [ ] Exactly eight hourly target rows are present.
- [ ] Sum of hourly targets equals plan planned quantity.
- [ ] Publishing a draft succeeds only for admin/supervisor.
- [ ] Published plan master fields cannot be changed by the normal UI.

## Hourly production
- [ ] One record per plan/hour is enforced.
- [ ] Actual cannot exceed that hour's planned quantity.
- [ ] Rejected cannot exceed actual.
- [ ] Serial start/end are required when actual is greater than zero.
- [ ] Rejection reason is required when rejected quantity is greater than zero.
- [ ] Actual includes rejected units; accepted is actual minus rejected.

## Rework
- [ ] An hourly rejection quantity of 3 creates three individual pending unit rows.
- [ ] Each pending unit can be resolved with its own remark.
- [ ] Completed/finally-rejected rows are locked.
- [ ] Rejected quantity cannot be reduced below resolved-unit count.
- [ ] Original rejection reason remains unchanged after resolution.

## Shift close and reports
- [ ] Shift cannot close until every scheduled hour has an entry.
- [ ] Report totals reconcile with hourly records.
- [ ] Rework completed and finally rejected are separate counts.
- [ ] Operators cannot read draft plans or change resolved rejection history.

Do not mark this checklist complete until tests have been executed against the actual Supabase staging project.
