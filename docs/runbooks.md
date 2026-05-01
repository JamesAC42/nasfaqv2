Make a user admin;

```
psql "$PROD_DATABASE_URL" -c "
UPDATE market.users
SET is_admin = true
WHERE lower(username) = lower('BBB')
RETURNING id, username, email, is_admin;
"
```