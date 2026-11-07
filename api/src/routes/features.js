const express = require("express");
const features = require("../features");

const router = express.Router();

// Every feature flag as the viewer resolves it (features/index.js), signed in or not:
// { features: { "stream-calendar": false, ... } }. The client hides gated links and boxes with it;
// the API withholds the gated data itself either way.
router.get("/", (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json({ features: features.forViewer(req.ctx?.user ?? null) });
});

module.exports = router;
