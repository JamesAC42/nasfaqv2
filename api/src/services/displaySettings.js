// A player's display settings (the Display section of /settings), behind the timezone-setting flag.
//
// So far one: how clock times show. "market" is New York market time (ET), as the site always showed
// them; "local" is the player's own time, whatever zone their browser is in (the client works it
// out, so it follows them when they travel). null means they haven't picked: times show in ET and
// the client may ask once, with a one-line prompt, whether they want their own time. Either answer
// to that prompt, or a pick on the Settings page, is stored here, so it holds on every device.
//
// Only what's shown changes. Market days, ticks, the check-in reset and the Saturday review stay on
// New York time whatever a player picks.
//
// One row per player who has picked (market.display_preferences). A new display setting is a new
// column there and a new entry in SETTINGS.

/** Every setting: its column and the values it takes. The API takes and returns them by these keys. */
const SETTINGS = Object.freeze({
  time_zone: { column: "time_zone", values: Object.freeze(["market", "local"]) },
});

function settingsError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

/** { time_zone: "market" | "local" | null }: null for anything the player hasn't picked. */
async function getDisplaySettings(db, userId) {
  const { rows } = await db.query(`SELECT * FROM market.display_preferences WHERE user_id = $1`, [userId]);
  const row = rows[0] || {};
  return Object.fromEntries(Object.entries(SETTINGS).map(([key, spec]) => [key, spec.values.includes(row[spec.column]) ? row[spec.column] : null]));
}

/** Sets the settings named in `changes` ({ time_zone: "local" }); others stay. Returns all of them. */
async function updateDisplaySettings(db, userId, changes) {
  const entries = Object.entries(changes && typeof changes === "object" && !Array.isArray(changes) ? changes : {});
  if (!entries.length) throw settingsError("invalid_settings");
  for (const [key, value] of entries) {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS, key)) throw settingsError("unknown_setting");
    if (!SETTINGS[key].values.includes(value)) throw settingsError("invalid_settings");
  }
  const columns = entries.map(([key]) => SETTINGS[key].column);
  const values = entries.map(([, value]) => value);
  await db.query(
    `
    INSERT INTO market.display_preferences (user_id, ${columns.join(", ")}, updated_at)
    VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(", ")}, now())
    ON CONFLICT (user_id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}, updated_at = now()
  `,
    [userId, ...values]
  );
  return getDisplaySettings(db, userId);
}

module.exports = { SETTINGS, getDisplaySettings, updateDisplaySettings };
