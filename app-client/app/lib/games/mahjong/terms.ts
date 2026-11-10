// Mahjong's vocabulary: the Japanese words players use, in plain English. The glossary page, the
// how-to-play glossary and anything else that wants to explain a word reads from here. Every
// statement agrees with docs/games/MAHJONG_DESIGN.md (the rules as this site plays them): where the
// common rule differs between sets, the entry says what the site does.

export type MahjongTerm = {
  /** The word as players say it, in romaji. */
  term: string;
  /** Roughly how to say it, for words that are not obvious. */
  reading?: string;
  /** The plain English meaning, short. */
  english: string;
  /** One or two sentences: what it is and why it matters. */
  explain: string;
};

export const MAHJONG_TERMS: ReadonlyArray<MahjongTerm> = [
  // ── Turn and winning ──────────────────────────────────────────────────────
  { term: "Riichi", reading: "REE-chee", english: "Declaring that you are one tile from winning", explain: "With a closed hand that is tenpai, you say riichi, pay a 1,000-point stick and turn your discard sideways. It is a yaku, but from then on you can only discard what you draw." },
  { term: "Tsumo", reading: "TSOO-moh", english: "Winning on a tile you drew yourself", explain: "A self-draw win. Everyone else pays you, and on a closed hand it is a yaku of its own (menzen tsumo)." },
  { term: "Ron", reading: "RONN", english: "Winning on another player’s discard", explain: "You call ron on a tile someone just threw. Only that player pays. Here, if two or three players ron the same discard, all of them are paid." },
  { term: "Agari", reading: "ah-GAH-ree", english: "A completed, winning hand", explain: "The shape of four sets and a pair (or seven pairs, or thirteen orphans) with at least one yaku. Tsumo and ron are the two ways to reach it." },
  { term: "Tenpai", reading: "TEN-pie", english: "Ready: one tile from winning", explain: "Your 13 tiles need exactly one more tile to be a winning hand. The tiles that finish it are your waits. Also called being ready or listening." },
  { term: "Noten", reading: "NOH-ten", english: "Not tenpai", explain: "What you are called at an exhaustive draw if your hand is not ready. You pay the players who are tenpai." },
  { term: "Shanten", reading: "SHAN-ten", english: "How many tiles away from tenpai", explain: "0 means tenpai, 1 (iishanten) means one useful draw from being tenpai, and so on. Counting it is the heart of choosing a discard." },
  { term: "Iishanten", reading: "EE-shan-ten", english: "One step from tenpai", explain: "Shanten of 1: one good tile makes you tenpai. Most hands spend most of their life here." },
  { term: "Furiten", reading: "foo-ree-TEN", english: "A wait you are not allowed to ron", explain: "If a tile you wait on is among your own discards (even one another player took), you can't win on anyone’s discard, only by self-draw. Passing a winning tile also locks you out for a while, and for the rest of the hand if you are in riichi." },
  { term: "Yaku", reading: "YAH-koo", english: "A scoring pattern", explain: "A hand needs at least one to win. Dora are not yaku: a hand that is only dora can't win." },
  { term: "Han", reading: "HAHN", english: "The doubling unit of a hand’s value", explain: "Each yaku is worth some han, and each dora adds one. Every han roughly doubles what the hand pays, up to the limits." },
  { term: "Fu", reading: "FOO", english: "Minipoints from the hand’s shape", explain: "Starts at 20 and grows with triplets, awkward waits, a closed win on a discard and a pair of value tiles. With han it sets the payment on small hands." },
  { term: "Dora", reading: "DOH-rah", english: "A bonus tile worth one han", explain: "The tile after the one shown on the dead wall (the dora indicator): after 4 of bamboo, every 5 of bamboo is dora. After a 9 it wraps to 1, winds go E S W N, dragons go white green red. Each dora in your winning hand adds a han." },
  { term: "Dora indicator", english: "The tile that shows what the dora is", explain: "Turned up on the dead wall at the start of the hand. The dora is the next tile in order after it. More indicators turn when someone makes a kan." },
  { term: "Ura dora", reading: "OO-rah DOH-rah", english: "Hidden bonus tiles under the dora indicators", explain: "Turned over only when a player who declared riichi wins. Each one works like a dora. They are why riichi hands sometimes score more than they looked." },
  { term: "Kan dora", reading: "KAN DOH-rah", english: "An extra dora indicator from a kan", explain: "Each kan turns another indicator, and so another dora. A closed kan turns it at once; an open or added kan turns it after the discard that follows." },
  { term: "Akadora", reading: "ah-kah-DOH-rah", english: "A red five", explain: "One five in each suit is red. A red five is dora wherever it is, so it is worth a han on top of whatever the hand scores. It still counts as an ordinary five for runs and triplets." },
  { term: "Mangan", reading: "MAN-gan", english: "The first limit hand: 2,000 base points", explain: "5 han, or 4 han at 40 fu or more, or 3 han at 70 fu or more. A non-dealer mangan wins 8,000 on a ron." },
  { term: "Haneman", reading: "hah-NEH-man", english: "A 6 or 7 han hand: 3,000 base points", explain: "One and a half times a mangan. A non-dealer haneman wins 12,000 on a ron." },
  { term: "Baiman", reading: "BYE-man", english: "An 8 to 10 han hand: 4,000 base points", explain: "Double a mangan. A non-dealer baiman wins 16,000 on a ron." },
  { term: "Sanbaiman", reading: "san-BYE-man", english: "An 11 or 12 han hand: 6,000 base points", explain: "Triple a mangan. A non-dealer sanbaiman wins 24,000 on a ron." },
  { term: "Yakuman", reading: "YAH-koo-man", english: "The biggest hand: 8,000 base points", explain: "A hand made of one of the rare yakuman patterns. A non-dealer yakuman wins 32,000 on a ron. Here every yakuman is worth one limit, and different yakuman in one hand add up." },
  { term: "Kazoe yakuman", reading: "kah-ZOH-eh YAH-koo-man", english: "Counted yakuman: 13 han or more", explain: "A hand that adds up to 13 han or more from ordinary yaku and dora is paid as a yakuman." },

  // ── People and seats ──────────────────────────────────────────────────────
  { term: "Oya", reading: "OH-yah", english: "The dealer", explain: "The player sitting East this hand. Dealers win and pay more (a dealer ron is 1.5 times a non-dealer’s), and keep the deal by winning." },
  { term: "Ko", reading: "KOH", english: "A non-dealer", explain: "Everyone who is not the dealer this hand." },
  { term: "Kamicha", reading: "kah-MEE-chah", english: "The player on your left", explain: "The player who plays just before you. You may chi their discards, and only theirs." },
  { term: "Toimen", reading: "TOY-men", english: "The player across from you", explain: "You can pon or kan their discards, but not chi them." },
  { term: "Shimocha", reading: "shee-moh-CHAH", english: "The player on your right", explain: "The player who plays just after you. They can chi what you throw." },
  { term: "Jikaze", reading: "jee-KAH-zeh", english: "Your seat wind", explain: "East for the dealer, then South, West, North around the table. A set of your seat wind is a yaku (value tile)." },
  { term: "Bakaze", reading: "bah-KAH-zeh", english: "The round wind", explain: "East in the first wind round of a game, South in the second. A set of the round wind is a yaku for everyone. When it is also your seat wind (East for the dealer in the East round), a set of it scores both, two han." },
  { term: "Tonpuusen", reading: "tohn-poo-SEN", english: "East-only game", explain: "One wind round: at least four hands. The shorter of the two lengths on this site." },
  { term: "Hanchan", reading: "HAHN-chahn", english: "East-South game", explain: "Two wind rounds: at least eight hands. The longer length." },
  { term: "Kyoku", reading: "KYOH-koo", english: "One hand of the game", explain: "From the deal to a win or a draw. “East 1” is the first hand, “East 4” the fourth." },
  { term: "Oorasu", reading: "OH-rah-soo", english: "The last hand (“all last”)", explain: "The last scheduled hand of the game. The dealer who wins it, or is tenpai when it draws, while in first with 30,000 or more, ends the game on the spot." },
  { term: "Renchan", reading: "REN-chan", english: "The dealer stays", explain: "The deal does not pass after a dealer win, after the dealer is tenpai at an exhaustive draw, or after any abortive draw. It adds to the honba." },
  { term: "Honba", reading: "HOHN-bah", english: "The repeat counter", explain: "A counter on the table that grows whenever a hand ends without the deal passing, or in a draw. Each one adds 300 to a ron win (100 from each player on a self-draw). It clears when a non-dealer wins." },
  { term: "Tobi", reading: "TOH-bee", english: "Bust: points below zero", explain: "The game ends at once when a hand leaves anyone below zero. Exactly zero plays on." },
  { term: "Riichi stick", english: "The 1,000-point stick you pay to riichi", explain: "It sits on the table until someone wins, and the next winner takes it. If the tile you declare riichi on is won on, the stick is never paid." },

  // ── Tiles ─────────────────────────────────────────────────────────────────
  { term: "Man", reading: "MAN", english: "The characters suit", explain: "One to nine, drawn here as the number over a stroke-drawn 萬. Also called wan." },
  { term: "Pin", reading: "PIN", english: "The circles suit", explain: "One to nine, drawn here as coins." },
  { term: "Sou", reading: "SOH", english: "The bamboo suit", explain: "One to nine, drawn here as green candlestick bars in the traditional layouts." },
  { term: "Jihai", reading: "jee-HIGH", english: "Honor tiles", explain: "The four winds and three dragons. They have no numbers and can only make triplets and pairs, never runs." },
  { term: "Kazehai", reading: "kah-zeh-HIGH", english: "Wind tiles", explain: "East, South, West and North. Which ones are yaku for you depends on your seat and the round." },
  { term: "Sangenpai", reading: "sahn-gen-PIE", english: "Dragon tiles", explain: "White (the empty frame), green (發) and red (中). A set of any dragon is a yaku all game, for everyone." },
  { term: "Yaochuuhai", reading: "yow-CHOO-high", english: "Terminals and honors", explain: "The 1s and 9s of the three suits and all seven honors: the thirteen kinds a kokushi hand wants. Also called orphans." },
  { term: "Routouhai", reading: "ROH-toh-high", english: "Terminals", explain: "The 1s and 9s of the three suits, without the honors." },
  { term: "Chunchanpai", reading: "choon-chahn-PIE", english: "Simples", explain: "The 2s through 8s. A hand of only simples is tanyao." },
  { term: "Yama", reading: "YAH-mah", english: "The wall", explain: "The tiles face-down in the middle, from which everyone draws. Each game’s seed decides every wall, and its hash is published when the game starts so anyone can check it afterward." },
  { term: "Wanpai", reading: "WAHN-pie", english: "The dead wall", explain: "The last 14 tiles: four replacement tiles for kans, five dora indicators and the five ura indicators under them. They can’t be drawn in the ordinary way." },
  { term: "Haipai", reading: "HIGH-pie", english: "The starting hand", explain: "The 13 tiles you are dealt (14 for the dealer)." },

  // ── Sets and shapes ───────────────────────────────────────────────────────
  { term: "Mentsu", reading: "MEN-tsoo", english: "A set", explain: "A run (shuntsu), a triplet (koutsu) or a kan. A winning hand is four sets and a pair." },
  { term: "Shuntsu", reading: "SHOON-tsoo", english: "A run", explain: "Three consecutive numbers in one suit, like 4-5-6 of circles. Honors can’t make runs." },
  { term: "Koutsu", reading: "KOHT-tsoo", english: "A triplet", explain: "Three identical tiles. Made by drawing them or by calling pon." },
  { term: "Toitsu", reading: "TOY-tsoo", english: "A pair", explain: "Two identical tiles. Seven pairs (chiitoitsu) is a hand made of them alone." },
  { term: "Jantou", reading: "JAHN-toh", english: "The pair of a hand", explain: "The one pair a normal winning hand has besides its four sets. Also called the head." },
  { term: "Taatsu", reading: "TAH-tsoo", english: "A partial run", explain: "Two tiles of a run, like 4-5 or 4-6, waiting for a third." },
  { term: "Menzen", reading: "MEN-zen", english: "Closed: no called sets", explain: "A hand with no chi, pon or open kan (closed kans are fine). Closed hands can riichi and score more yaku and fu." },
  { term: "Naki", reading: "NAH-kee", english: "Calling", explain: "Taking another player’s discard to make a set: chi, pon or an open kan. It opens your hand." },
  { term: "Chi", reading: "CHEE", english: "Calling a run", explain: "Take the discard of the player on your left to complete a run in your hand. It can only be that player, and ron and pon outrank it." },
  { term: "Pon", reading: "POHN", english: "Calling a triplet", explain: "Take a discard that matches two tiles in your hand from anyone. Pon and kan outrank chi, and ron outranks everything." },
  { term: "Kan", reading: "KAHN", english: "A four-of-a-kind set", explain: "Counts as one set, and gives you a replacement tile and a new dora indicator. Closed kan, open kan and added kan are the three ways to make one. At most four kans per hand." },
  { term: "Minkan", reading: "MEEN-kan", english: "Open kan", explain: "Calling a fourth tile from a discard when you hold three. It opens your hand." },
  { term: "Ankan", reading: "AHN-kan", english: "Closed kan", explain: "Four tiles you hold yourself, declared on your own turn. It keeps your hand closed and turns a dora at once." },
  { term: "Kakan", reading: "kah-KAHN", english: "Added kan", explain: "Adding the fourth tile to a pon you already made. It can be robbed (chankan) by someone waiting on that tile." },
  { term: "Kuikae", reading: "KOO-ee-kah-eh", english: "Swap-calling", explain: "After a chi or pon you can’t discard the same kind of tile you just took, or the tile at the far end of the run you just made (taking 4 for 2-3 and throwing the 1). It is not allowed here." },

  // ── Waits ─────────────────────────────────────────────────────────────────
  { term: "Ryanmen", reading: "ree-AHN-men", english: "Two-sided wait", explain: "A run missing an end, like 4-5 waiting on 3 or 6. The best shape: up to eight tiles can finish it." },
  { term: "Kanchan", reading: "KAHN-chahn", english: "Middle wait", explain: "A run missing its middle, like 4-6 waiting on 5. Only one kind of tile finishes it." },
  { term: "Penchan", reading: "PEN-chahn", english: "Edge wait", explain: "1-2 waiting on 3, or 8-9 waiting on 7. Only one kind of tile finishes it." },
  { term: "Shanpon", reading: "SHAN-pohn", english: "Double-pair wait", explain: "Two pairs where either can become a triplet. Two kinds of tile finish it, up to four tiles in all." },
  { term: "Tanki", reading: "TAHN-kee", english: "Single-tile wait", explain: "Everything is done but the pair: one tile waits for its twin." },
  { term: "Nobetan", reading: "noh-beh-TAHN", english: "Four-tile run wait", explain: "A run of four, like 2-3-4-5, which can finish as 2-3-4 and a 5 pair, or 3-4-5 and a 2 pair, so it waits on two tiles." },
  { term: "Machi", reading: "MAH-chee", english: "A wait", explain: "The tile or tiles that would complete a tenpai hand." },
  { term: "Ukeire", reading: "oo-keh-EE-reh", english: "Useful tiles", explain: "How many tiles in the unseen pool would move your hand forward. A discard that leaves more ukeire is more efficient." },

  // ── Defense and strategy ──────────────────────────────────────────────────
  { term: "Genbutsu", reading: "GEN-boo-tsoo", english: "A tile that is certainly safe", explain: "A tile the player in riichi has already discarded: they can’t win on it, because of furiten. The safest tile there is." },
  { term: "Suji", reading: "SOO-jee", english: "A tile that is safer against a two-sided wait", explain: "If a player in riichi discarded a 4, then 1 and 7 are less likely to be their wait (a 2-3 would wait on 1 or 4, and 5-6 on 4 or 7). Suji reduces risk, it does not remove it." },
  { term: "Kabe", reading: "KAH-beh", english: "A wall", explain: "When all four copies of a tile are visible, nobody can be waiting on a shape that needs it, which makes the tiles next to it a little safer. It never makes a tile fully safe." },
  { term: "Betaori", reading: "beh-tah-OH-ree", english: "Folding completely", explain: "Giving up the hand and throwing only safe tiles until the danger ends." },
  { term: "Mawashi", reading: "mah-WAH-shee", english: "Pushing carefully", explain: "Keeping your hand alive while choosing the safest tile you can: a middle path between attacking and folding." },
  { term: "Oriru", reading: "oh-REE-roo", english: "To fold", explain: "To stop trying to win and play for safety." },
  { term: "Houjuu", reading: "HOH-joo", english: "Dealing in", explain: "Discarding the tile someone wins on. The player who deals in pays the whole ron." },
  { term: "Sute-hai", reading: "SOO-teh-high", english: "A discard", explain: "A discarded tile. Discards stay in front of the player in the order they were thrown, so they can be read." },
  { term: "Tsumogiri", reading: "tsoo-moh-GEE-ree", english: "Discarding the tile you just drew", explain: "Every discard after riichi is this, unless you win or declare a kan. Someone discarding tsumogiri has not changed their hand." },
  { term: "Tedashi", reading: "teh-DAH-shee", english: "Discarding from your hand", explain: "Throwing a tile you were already holding. It means your hand changed, which is why it is read." },
  { term: "Dama", reading: "DAH-mah", english: "Tenpai without riichi", explain: "Staying quiet on a ready hand: no stick, nobody warned, and your hand is still free to change. Possible only with another yaku." },
  { term: "Push", english: "To keep attacking", explain: "Throwing a risky tile to keep your hand going. The opposite of fold." },
  { term: "Kuitan", reading: "KOO-ee-tahn", english: "Open all simples", explain: "Calling to make a hand of only 2s through 8s. Allowed here: open hands can score tanyao." },
  { term: "Placement", english: "Your finishing position", explain: "First to fourth. The final score gives +15, +5, −5 and −15 for it on top of points, so late in the game finishing higher can matter more than points." },

  // ── Draws ─────────────────────────────────────────────────────────────────
  { term: "Ryuukyoku", reading: "ree-YOO-kyoh-koo", english: "A draw", explain: "A hand that ends with nobody winning: the wall running out (exhaustive), or one of the abortive draws." },
  { term: "Nagashi mangan", reading: "nah-GAH-shee MAN-gan", english: "Discards of only terminals and honors", explain: "At an exhaustive draw, if every one of your discards was a terminal or an honor and none was called, you are paid a mangan as if self-drawn, instead of the tenpai payments." },
  { term: "Kyuushu kyuuhai", reading: "KYOO-shoo KYOO-high", english: "Nine different terminals and honors", explain: "If your first draw, before any call, leaves you with nine different terminals and honors, you may call the hand off. It is your choice, and the dealer stays." },
  { term: "Suufon renda", reading: "SOO-fohn REN-dah", english: "Four of the same wind", explain: "All four players discard the same wind on the first go-around: an abortive draw." },
  { term: "Suucha riichi", reading: "SOO-chah REE-chee", english: "Four riichi", explain: "All four players are in riichi: an abortive draw." },
  { term: "Suukaikan", reading: "SOO-kai-kan", english: "Four kans by more than one player", explain: "An abortive draw once the fourth kan’s discard goes by. A fifth kan is never allowed." },
  { term: "Tochuu ryuukyoku", reading: "toh-CHOO ree-YOO-kyoh-koo", english: "An abortive draw", explain: "Any of the four draws above. No points move, the dealer stays and a honba is added." },
  { term: "Pao", reading: "PAH-oh", english: "Responsibility", explain: "If you feed the pon or open kan that completes a visible big three dragons or big four winds, you pay the whole of a self-drawn win and half of a win on someone else’s discard." },
  { term: "Atamahane", reading: "ah-tah-mah-HAH-neh", english: "Head bump", explain: "A rule that pays only the first of several players who ron the same tile. Not used here: every winner is paid." },

  // ── Yaku ──────────────────────────────────────────────────────────────────
  { term: "Menzen tsumo", reading: "MEN-zen TSOO-moh", english: "Fully concealed hand (1 han)", explain: "Win by self-draw with no called sets." },
  { term: "Ippatsu", reading: "ip-PAHT-soo", english: "One shot (1 han)", explain: "Win within one go-around after declaring riichi, before your next discard, and with nobody calling a tile in between." },
  { term: "Pinfu", reading: "PIN-foo", english: "No-points hand (1 han)", explain: "Closed hand of four runs and a plain pair, won on a two-sided wait." },
  { term: "Iipeikou", reading: "ee-PAY-koh", english: "Pure double sequence (1 han)", explain: "Two identical runs in one suit, in a closed hand." },
  { term: "Tanyao", reading: "TAHN-yow", english: "All simples (1 han)", explain: "Every tile is a 2 through 8. Open hands score it too." },
  { term: "Yakuhai", reading: "YAH-koo-high", english: "Value tiles (1 han each)", explain: "A set of a dragon, of your seat wind or of the round wind. Pon one and you have a yaku." },
  { term: "Haku", reading: "HAH-koo", english: "The white dragon", explain: "The blank tile. A set of it is a yaku." },
  { term: "Hatsu", reading: "HAHT-soo", english: "The green dragon", explain: "A set of it is a yaku." },
  { term: "Chun", reading: "CHOON", english: "The red dragon", explain: "A set of it is a yaku. Not to be confused with the red fives." },
  { term: "Rinshan kaihou", reading: "reen-SHAN kai-HOH", english: "After a kan (1 han)", explain: "Win on the replacement tile you draw after declaring a kan." },
  { term: "Chankan", reading: "CHAHN-kahn", english: "Robbing a kan (1 han)", explain: "Win on the tile another player adds to a pon to make a kan. A closed kan can’t be robbed, not even for thirteen orphans." },
  { term: "Haitei raoyue", reading: "high-TAY rah-oh-YOO-eh", english: "Under the sea (1 han)", explain: "Win by self-draw on the last tile of the wall." },
  { term: "Houtei raoyui", reading: "hoh-TAY rah-oh-YOO-ee", english: "Under the river (1 han)", explain: "Win on the last discard of the hand." },
  { term: "Daburu riichi", reading: "dah-BOO-roo REE-chee", english: "Double riichi (2 han)", explain: "Riichi on your very first discard, before anyone has called." },
  { term: "Chiitoitsu", reading: "chee-TOY-tsoo", english: "Seven pairs (2 han)", explain: "Seven different pairs, closed. Always 25 fu." },
  { term: "Sanshoku doujun", reading: "san-SHOH-koo DOH-joon", english: "Mixed triple sequence (2 han, 1 open)", explain: "The same run in all three suits." },
  { term: "Ittsu", reading: "EET-tsoo", english: "Pure straight (2 han, 1 open)", explain: "1-2-3, 4-5-6 and 7-8-9 in one suit." },
  { term: "Chanta", reading: "CHAHN-tah", english: "Half outside hand (2 han, 1 open)", explain: "Every set and the pair has a terminal or honor, with at least one run and one honor." },
  { term: "Toitoi", reading: "TOY-toy", english: "All triplets (2 han)", explain: "Four triplets and a pair, no runs. Pons are fine." },
  { term: "Sanankou", reading: "sahn-AHN-koh", english: "Three concealed triplets (2 han)", explain: "Three triplets you drew yourself. One finished on a discard counts as called." },
  { term: "Sanshoku doukou", reading: "san-SHOH-koo DOH-koh", english: "Triple triplets (2 han)", explain: "A triplet of the same number in all three suits." },
  { term: "Sankantsu", reading: "san-KAHN-tsoo", english: "Three kans (2 han)", explain: "Three kans in one hand." },
  { term: "Honroutou", reading: "hohn-ROH-toh", english: "All terminals and honors (2 han)", explain: "Every tile is a 1, a 9 or an honor, and no runs." },
  { term: "Shousangen", reading: "shoh-SAHN-gen", english: "Little three dragons (2 han)", explain: "Sets of two dragons and a pair of the third." },
  { term: "Honitsu", reading: "HOHN-ee-tsoo", english: "Half flush (3 han, 2 open)", explain: "One suit and honors." },
  { term: "Junchan", reading: "JOON-chahn", english: "Fully outside hand (3 han, 2 open)", explain: "Every set and the pair has a 1 or a 9, no honors, at least one run." },
  { term: "Ryanpeikou", reading: "ree-AHN-pay-koh", english: "Twice pure double sequence (3 han)", explain: "Two pairs of identical runs. Closed only." },
  { term: "Chinitsu", reading: "CHEEN-ee-tsoo", english: "Full flush (6 han, 5 open)", explain: "One suit, no honors." },
  { term: "Kokushi musou", reading: "KOH-koo-shee MOO-soh", english: "Thirteen orphans (yakuman)", explain: "One of each terminal and honor and a second copy of any of them. Closed only." },
  { term: "Suuankou", reading: "SOO-ahn-koh", english: "Four concealed triplets (yakuman)", explain: "Four triplets you drew yourself, and a pair. Closed only." },
  { term: "Daisangen", reading: "die-SAHN-gen", english: "Big three dragons (yakuman)", explain: "A set of each dragon. Feeding the last one makes you pay for the hand." },
  { term: "Shousuushii", reading: "shoh-SOO-shee", english: "Little four winds (yakuman)", explain: "Sets of three winds and a pair of the fourth." },
  { term: "Daisuushii", reading: "die-SOO-shee", english: "Big four winds (yakuman)", explain: "Sets of all four winds. Feeding the last one makes you pay for the hand." },
  { term: "Tsuuiisou", reading: "tsoo-EE-soh", english: "All honors (yakuman)", explain: "Every tile is a wind or a dragon." },
  { term: "Chinroutou", reading: "cheen-ROH-toh", english: "All terminals (yakuman)", explain: "Every tile is a 1 or a 9." },
  { term: "Ryuuiisou", reading: "ree-oo-EE-soh", english: "All green (yakuman)", explain: "Only 2, 3, 4, 6 and 8 of bamboo and the green dragon." },
  { term: "Chuuren poutou", reading: "CHOO-ren POH-toh", english: "Nine gates (yakuman)", explain: "One suit, closed: 1-1-1, 2 to 8 and 9-9-9, plus any one more tile of that suit." },
  { term: "Suukantsu", reading: "SOO-kahn-tsoo", english: "Four kans (yakuman)", explain: "Four kans and a pair." },
  { term: "Tenhou", reading: "TEN-hoh", english: "Blessing of heaven (yakuman)", explain: "The dealer wins on their first draw." },
  { term: "Chiihou", reading: "CHEE-hoh", english: "Blessing of earth (yakuman)", explain: "A non-dealer wins on their first draw, with nobody having called." },
];

/** A lookup by lowercase term, for pages that link a word to its entry. */
export const TERM_BY_NAME: ReadonlyMap<string, MahjongTerm> = new Map(MAHJONG_TERMS.map((entry) => [entry.term.toLowerCase(), entry]));

/** The anchor id for a term on the glossary page: "furiten", "sanshoku-doujun". */
export const termAnchor = (term: string) =>
  term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
