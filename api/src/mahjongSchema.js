// Mahjong's tables (docs/games/MAHJONG_DESIGN.md): games and who sat in them, every hand with its
// replay log, the season ladder, paid entries (what the weekly cap counts), tournaments and
// spectators' picks. Every statement is idempotent.

async function applyMahjongSchema(pool) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS games`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_tournaments (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'signup',
      seats SMALLINT NOT NULL,
      length TEXT NOT NULL DEFAULT 'east',
      final_length TEXT NOT NULL DEFAULT 'south',
      speed TEXT NOT NULL DEFAULT 'standard',
      entry_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      -- False once a bot had to take a seat: every fee is refunded and no prize is paid.
      paid BOOLEAN NOT NULL DEFAULT false,
      starts_at TIMESTAMPTZ NOT NULL,
      repeat_weekly BOOLEAN NOT NULL DEFAULT false,
      created_by BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      bracket_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      CONSTRAINT games_mahjong_tournaments_status_check CHECK (status IN ('signup', 'running', 'completed', 'cancelled')),
      CONSTRAINT games_mahjong_tournaments_seats_check CHECK (seats IN (4, 8, 16)),
      CONSTRAINT games_mahjong_tournaments_name_check CHECK (char_length(name) BETWEEN 3 AND 60)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_tournaments_status_idx ON games.mahjong_tournaments (status, starts_at)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_tournament_players (
      tournament_id BIGINT NOT NULL REFERENCES games.mahjong_tournaments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'registered',
      place SMALLINT NULL,
      payout NUMERIC(18,2) NOT NULL DEFAULT 0,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tournament_id, user_id),
      CONSTRAINT games_mahjong_tournament_players_status_check CHECK (status IN ('registered', 'withdrawn', 'playing', 'out', 'finished'))
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_tournament_players_user_idx ON games.mahjong_tournament_players (user_id, registered_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_games (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      length TEXT NOT NULL DEFAULT 'east',
      speed TEXT NOT NULL DEFAULT 'standard',
      entry_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      rated BOOLEAN NOT NULL DEFAULT false,
      humans SMALLINT NOT NULL DEFAULT 0,
      room_code TEXT NULL,
      host_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      tournament_id BIGINT NULL REFERENCES games.mahjong_tournaments(id) ON DELETE SET NULL,
      tournament_round SMALLINT NULL,
      tournament_table SMALLINT NULL,
      -- The wall's seal: the hash from the first deal, the seed itself only once the game is over.
      seed_hash TEXT NULL,
      seed TEXT NULL,
      settings_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      CONSTRAINT games_mahjong_games_kind_check CHECK (kind IN ('ranked', 'friend', 'stakes', 'tournament')),
      CONSTRAINT games_mahjong_games_status_check CHECK (status IN ('waiting', 'playing', 'completed', 'cancelled'))
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_games_status_idx ON games.mahjong_games (status, completed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_games_tournament_idx ON games.mahjong_games (tournament_id) WHERE tournament_id IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_game_players (
      game_id BIGINT NOT NULL REFERENCES games.mahjong_games(id) ON DELETE CASCADE,
      seat SMALLINT NOT NULL,
      user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      bot_level TEXT NULL,
      name TEXT NOT NULL,
      talent TEXT NULL,
      place SMALLINT NULL,
      points INTEGER NULL,
      score NUMERIC(8,1) NULL,
      rating_before NUMERIC(8,2) NULL,
      rating_after NUMERIC(8,2) NULL,
      fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      payout NUMERIC(18,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (game_id, seat)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_game_players_user_idx ON games.mahjong_game_players (user_id, game_id DESC) WHERE user_id IS NOT NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_hands (
      game_id BIGINT NOT NULL REFERENCES games.mahjong_games(id) ON DELETE CASCADE,
      hand_index SMALLINT NOT NULL,
      wind SMALLINT NOT NULL,
      number SMALLINT NOT NULL,
      honba SMALLINT NOT NULL DEFAULT 0,
      dealer SMALLINT NOT NULL,
      result_type TEXT NOT NULL,
      reason TEXT NULL,
      -- The hand's best win, for leaderboards and the hand of the day; result_json has every winner.
      winner_seat SMALLINT NULL,
      winner_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      loser_seat SMALLINT NULL,
      han SMALLINT NULL,
      fu SMALLINT NULL,
      yakuman SMALLINT NOT NULL DEFAULT 0,
      points INTEGER NULL,
      limit_name TEXT NULL,
      yaku TEXT[] NOT NULL DEFAULT '{}',
      start_scores INTEGER[] NOT NULL DEFAULT '{}',
      result_json JSONB NOT NULL DEFAULT '{}'::JSONB,
      log_json JSONB NOT NULL DEFAULT '[]'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, hand_index)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_hands_big_idx ON games.mahjong_hands (created_at DESC, points DESC) WHERE winner_user_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_hands_winner_idx ON games.mahjong_hands (winner_user_id, created_at DESC) WHERE winner_user_id IS NOT NULL`);

  // One row per player per season (a calendar month, New York time): the ladder and the record.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_ratings (
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      season TEXT NOT NULL,
      rating NUMERIC(8,2) NOT NULL DEFAULT 1500,
      peak NUMERIC(8,2) NOT NULL DEFAULT 1500,
      games INTEGER NOT NULL DEFAULT 0,
      firsts INTEGER NOT NULL DEFAULT 0,
      seconds INTEGER NOT NULL DEFAULT 0,
      thirds INTEGER NOT NULL DEFAULT 0,
      fourths INTEGER NOT NULL DEFAULT 0,
      total_score NUMERIC(10,1) NOT NULL DEFAULT 0,
      hands INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      tsumo INTEGER NOT NULL DEFAULT 0,
      deal_ins INTEGER NOT NULL DEFAULT 0,
      riichi INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      yakuman INTEGER NOT NULL DEFAULT 0,
      best_points INTEGER NOT NULL DEFAULT 0,
      best_game_id BIGINT NULL,
      best_hand_index SMALLINT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, season)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_ratings_ladder_idx ON games.mahjong_ratings (season, rating DESC)`);

  // What a player paid to sit down and what came back: the weekly cap and the daily count read these.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      game_id BIGINT NULL REFERENCES games.mahjong_games(id) ON DELETE SET NULL,
      tournament_id BIGINT NULL REFERENCES games.mahjong_tournaments(id) ON DELETE SET NULL,
      fee NUMERIC(18,2) NOT NULL,
      -- The most this entry can come out ahead (first prize less the fee): room is held for it.
      max_net NUMERIC(18,2) NOT NULL DEFAULT 0,
      payout NUMERIC(18,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      settled_at TIMESTAMPTZ NULL,
      CONSTRAINT games_mahjong_entries_status_check CHECK (status IN ('open', 'settled', 'refunded')),
      CONSTRAINT games_mahjong_entries_fee_check CHECK (fee > 0)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_entries_user_idx ON games.mahjong_entries (user_id, created_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS games_mahjong_entries_game_idx ON games.mahjong_entries (game_id, user_id) WHERE game_id IS NOT NULL AND status <> 'refunded'`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS games_mahjong_entries_tournament_idx ON games.mahjong_entries (tournament_id, user_id) WHERE tournament_id IS NOT NULL AND status <> 'refunded'`);

  // A spectator's free call on who wins a game or a tournament. Never worth anything but the tally.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games.mahjong_picks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES market.users(id) ON DELETE CASCADE,
      game_id BIGINT NULL REFERENCES games.mahjong_games(id) ON DELETE CASCADE,
      tournament_id BIGINT NULL REFERENCES games.mahjong_tournaments(id) ON DELETE CASCADE,
      seat SMALLINT NULL,
      picked_user_id BIGINT NULL REFERENCES market.users(id) ON DELETE SET NULL,
      picked_name TEXT NOT NULL,
      correct BOOLEAN NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT games_mahjong_picks_one_ref_check CHECK ((game_id IS NULL) <> (tournament_id IS NULL))
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS games_mahjong_picks_game_idx ON games.mahjong_picks (game_id, user_id) WHERE game_id IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS games_mahjong_picks_tournament_idx ON games.mahjong_picks (tournament_id, user_id) WHERE tournament_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS games_mahjong_picks_user_idx ON games.mahjong_picks (user_id, created_at DESC)`);
}

module.exports = { applyMahjongSchema };
