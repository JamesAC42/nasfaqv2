const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";

/**
 * SQL for a user's avatar URL. A card reaction the user picked (`users.profile_reaction`, e.g.
 * "PEK/hype") wins and comes out as "reaction:PEK/hype", which the web client draws from the art
 * manifest; otherwise the catalog picture joined as `alias`. `userAlias` is the users table alias.
 */
function profilePictureUrlSql(size, alias = "pp", userAlias = "u") {
  const folder = size === "small" ? "small" : "large";
  const field = size === "small" ? "filename_small" : "filename_large";
  return `CASE
    WHEN ${userAlias}.profile_reaction IS NOT NULL THEN 'reaction:' || ${userAlias}.profile_reaction
    WHEN ${alias}.id IS NULL OR ${alias}.is_deleted THEN NULL
    ELSE '${PROFILE_PICTURE_CDN_BASE_URL}/${folder}/' || ${alias}.${field} END`;
}

module.exports = { PROFILE_PICTURE_CDN_BASE_URL, profilePictureUrlSql };
