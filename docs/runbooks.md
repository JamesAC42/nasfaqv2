Make a user admin;

```
psql "$PROD_DATABASE_URL" -c "
UPDATE market.users
SET is_admin = true
WHERE lower(username) = lower('YOUR_USERNAME')
RETURNING id, username, email, is_admin;
"
```