// Per-frame lighting levels the scene shares (written by the lights, read by portraits, tiles and the room).
// A plain mutable object: it changes every frame, so it must not go through React state.

export const fx = {
  /** Overall room level, 1 normal, lower when a moment dims the room. */
  room: 1,
  /** Extra light on each seat (the win spotlight). */
  seat: [0, 0, 0, 0],
  /** The tiles' front light (see scene-tiles' material): how strong it is now. */
  front: 0,
};
