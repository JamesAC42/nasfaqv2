# Directory Structure

```
.github/
  workflows/
    ci.yml (41 lines)
    deploy.yml (93 lines)
4chanscraper/
  cmd/
    4chanscraper/
      main.go (726 lines)
  env.example (9 lines)
  go.mod (13 lines)
alg-lab/
  backfill-youtube-daily-stats.js (583 lines)
  describe-json-schema.js (199 lines)
  download-getStats.js (71 lines)
api/
  scripts/
    exercise-prediction-market-canonical.js (549 lines)
    migrate.js (21 lines)
  src/
    routes/
      adminAssets.js (108 lines)
      adminHolonews.js (28 lines)
      analysis.js (54 lines)
      articles.js (228 lines)
      assets.js (24 lines)
      auth.js (153 lines)
      channels.js (777 lines)
      chat.js (314 lines)
      games.js (188 lines)
      internalMarket.js (366 lines)
      leaderboard.js (110 lines)
      livestreams.js (289 lines)
      market.js (759 lines)
      nasfaqThread.js (341 lines)
      news.js (56 lines)
      overview.js (159 lines)
      portfolio.js (68 lines)
      predictionMarkets.js (386 lines)
      profiles.js (240 lines)
      stats.js (22 lines)
    services/
      achievements/
        definitions.js (122 lines)
        index.js (488 lines)
        streaks.js (331 lines)
      games/
        catalog.js (247 lines)
        gacha.js (300 lines)
        gachaPrizeCatalog.js (298 lines)
        inventory.js (408 lines)
        sessions.js (440 lines)
        wallet.js (195 lines)
      auth.js (659 lines)
      fundamentals.js (687 lines)
      holonewsThumbnails.js (589 lines)
      marketAdjustments.js (1304 lines)
      marketAdmin.js (427 lines)
      marketEvents.js (29 lines)
      marketScheduler.js (399 lines)
      marketState.js (188 lines)
      mediaCatalog.js (496 lines)
      netWorth.js (1332 lines)
      portfolioCash.js (53 lines)
      predictionMarketEvents.js (23 lines)
      predictionMarketService.js (363 lines)
      predictionOrderbook.js (1253 lines)
      predictionPermissions.js (79 lines)
      predictionScheduler.js (111 lines)
      predictionSettlement.js (481 lines)
      settlement.js (706 lines)
      trading.js (1432 lines)
    articleDb.js (1384 lines)
    chatDb.js (1133 lines)
    config.js (53 lines)
    db.js (554 lines)
    marketCache.js (82 lines)
    marketDb.js (2283 lines)
    migrations.js (1391 lines)
    predictionMarketDb.js (1285 lines)
    profileDb.js (792 lines)
    redis.js (17 lines)
    server.js (702 lines)
    userContext.js (34 lines)
  ACHIEVEMENTS_DESIGN.md (453 lines)
  Dockerfile (15 lines)
  env.example (61 lines)
  package.json (23 lines)
  README.md (53 lines)
app-client/
  app/
    admin/
      assets/
        page.tsx (5 lines)
      market-tuning/
        page.tsx (5 lines)
      predictions/
        page.tsx (10 lines)
    articles/
      [slug]/
        edit/
          page.tsx (10 lines)
        page.tsx (10 lines)
      new/
        page.tsx (5 lines)
      page.tsx (5 lines)
    chat/
      page.tsx (10 lines)
    components/
      admin/
        admin-assets-page.module.scss (210 lines)
        admin-assets-page.tsx (670 lines)
        admin-market-tuning-page.module.scss (615 lines)
        admin-market-tuning-page.tsx (1185 lines)
      articles/
        article-pages.module.scss (2129 lines)
      auth/
        auth-form.module.scss (157 lines)
        auth-form.tsx (209 lines)
      charts/
        market-charts.module.scss (396 lines)
        market-charts.tsx (1129 lines)
      common/
        asset-coin.module.scss (60 lines)
        asset-coin.tsx (45 lines)
        asset-picker.module.scss (134 lines)
        asset-picker.tsx (135 lines)
        channel-ticker-pill.module.scss (317 lines)
        channel-ticker-pill.tsx (322 lines)
        filter-panel.module.scss (203 lines)
        filter-panel.tsx (56 lines)
        loading-spinner.module.scss (20 lines)
        loading-spinner.tsx (114 lines)
        market-sidebar.tsx (384 lines)
        option-picker.module.scss (110 lines)
        option-picker.tsx (120 lines)
        quick-trade-flyout.tsx (673 lines)
        verification-required-notice.tsx (59 lines)
      games/
        game-detail-page.module.scss (1049 lines)
        game-detail-page.tsx (1322 lines)
        games-home-page.module.scss (645 lines)
        games-home-page.tsx (445 lines)
        item-locker-page.module.scss (536 lines)
        item-locker-page.tsx (568 lines)
      home/
        asset-detail-section.module.scss (90 lines)
        asset-detail-section.tsx (236 lines)
        channel-overview-section.module.scss (29 lines)
        channel-overview-section.tsx (44 lines)
        home-page.module.scss (1191 lines)
        home-page.tsx (1207 lines)
        home-sidebar-section.module.scss (347 lines)
        home-sidebar-section.tsx (359 lines)
        leaderboard-section.module.scss (124 lines)
        leaderboard-section.tsx (63 lines)
        livestream-section.module.scss (271 lines)
        livestream-section.tsx (148 lines)
        market-overview-section.module.scss (266 lines)
        market-overview-section.tsx (319 lines)
        market-report-section.module.scss (180 lines)
        market-report-section.tsx (285 lines)
        news-section.module.scss (345 lines)
        news-section.tsx (385 lines)
      layout/
        site-shell.module.scss (729 lines)
        site-shell.tsx (615 lines)
      livestreams/
        livestream-listing.module.scss (615 lines)
        livestream-listing.tsx (745 lines)
        livestream-modal.module.scss (364 lines)
        livestream-modal.tsx (577 lines)
      oshiboard/
        oshiboard-panel.module.scss (309 lines)
        oshiboard-panel.tsx (149 lines)
      pages/
        article-detail-page.tsx (1118 lines)
        article-editor-page.tsx (447 lines)
        articles-page.tsx (334 lines)
        chat-page.module.scss (957 lines)
        chat-page.tsx (1465 lines)
        finance-rankings-page.module.scss (860 lines)
        finance-rankings-page.tsx (898 lines)
        indexes-page.module.scss (690 lines)
        indexes-page.tsx (477 lines)
        leaderboard-page.module.scss (1113 lines)
        leaderboard-page.tsx (619 lines)
        market-page.module.scss (1390 lines)
        market-page.tsx (1429 lines)
        market-report-page.module.scss (1075 lines)
        market-report-page.tsx (655 lines)
        nasfaq-thread-page.module.scss (806 lines)
        nasfaq-thread-page.tsx (1093 lines)
        news-page.module.scss (565 lines)
        news-page.tsx (441 lines)
        oshiboard-page.module.scss (317 lines)
        oshiboard-page.tsx (196 lines)
        page-shell.module.scss (311 lines)
        predictions-page.module.scss (1086 lines)
        predictions-page.tsx (1326 lines)
        stock-detail-page.module.scss (2866 lines)
        stock-detail-page.tsx (3912 lines)
        stocks-page.module.scss (1243 lines)
        stocks-page.tsx (2085 lines)
      profile/
        profile-page.module.scss (1450 lines)
        profile-page.tsx (1526 lines)
    finance/
      activity/
        page.tsx (5 lines)
      rankings/
        page.tsx (5 lines)
    games/
      [game]/
        page.tsx (10 lines)
      item-locker/
        page.tsx (5 lines)
      page.tsx (5 lines)
    indexes/
      page.tsx (5 lines)
    leaderboard/
      page.tsx (5 lines)
    lib/
      api.ts (28 lines)
      chart-theme.ts (215 lines)
      color.ts (105 lines)
      config.ts (1 lines)
      format.ts (48 lines)
      games-api.ts (71 lines)
      market-metrics.ts (37 lines)
      normalizers.ts (2218 lines)
      thumbnails.ts (27 lines)
      trade-confirmation-images.ts (36 lines)
      types.ts (1516 lines)
      ws.ts (51 lines)
    livestreams/
      page.tsx (10 lines)
    login/
      page.tsx (5 lines)
    market/
      page.tsx (5 lines)
    news/
      page.tsx (5 lines)
    oshiboard/
      page.tsx (5 lines)
    predictions/
      [slug]/
        page.tsx (11 lines)
      create/
        page.tsx (10 lines)
      manage/
        page.tsx (10 lines)
      page.tsx (10 lines)
    privacy/
      page.tsx (73 lines)
    profile/
      [username]/
        page.tsx (10 lines)
      page.tsx (5 lines)
    providers/
      app-providers.tsx (27 lines)
      auth-provider.tsx (189 lines)
      theme-provider.tsx (55 lines)
    register/
      page.tsx (5 lines)
    stocks/
      [stockName]/
        page.tsx (11 lines)
      page.tsx (5 lines)
    stores/
      auth-store.ts (34 lines)
      channel-store.ts (30 lines)
      leaderboard-store.ts (102 lines)
      livestream-store.ts (233 lines)
      market-store.ts (504 lines)
      news-store.ts (38 lines)
      prediction-market-store.ts (208 lines)
      profile-store.ts (130 lines)
    styles/
      _fonts.scss (27 lines)
      _mixins.scss (210 lines)
      _theme.scss (186 lines)
    terms/
      page.tsx (49 lines)
    threads/
      page.tsx (5 lines)
    verify-email/
      page.tsx (71 lines)
    globals.scss (167 lines)
    layout.tsx (29 lines)
    page.tsx (5 lines)
  public/
    fonts/
      Mukta_Mahee/
        OFL.txt (93 lines)
      Red_Hat_Mono/
        OFL.txt (93 lines)
        README.txt (73 lines)
      Rethink_Sans/
        OFL.txt (93 lines)
        README.txt (73 lines)
      .gitkeep (0 lines)
    trade-confirmations/
      README.md (18 lines)
    file.svg (1 lines)
    globe.svg (1 lines)
    next.svg (1 lines)
    vercel.svg (1 lines)
    window.svg (1 lines)
  .gitignore (41 lines)
  AGENTS.md (5 lines)
  CLAUDE.md (1 lines)
  Dockerfile (25 lines)
  env.example (9 lines)
  eslint.config.mjs (18 lines)
  next.config.ts (19 lines)
  package.json (33 lines)
  postcss.config.mjs (7 lines)
  README.md (36 lines)
  tsconfig.json (35 lines)
brokerbot/
  app/
    public/
      index.html (116 lines)
      script.js (373 lines)
      style.css (412 lines)
    package.json (13 lines)
    server.js (226 lines)
  training/
    generate_synthetic_data.py (662 lines)
    inspector.py (46 lines)
    merge_and_shuffle.py (149 lines)
    requirements.txt (7 lines)
    scraper.py (596 lines)
    train.py (109 lines)
    upload.py (13 lines)
channelscraper/
  cmd/
    backfill-symbols/
      main.go (215 lines)
    detect/
      main.go (53 lines)
    update-db/
      main.go (355 lines)
  internal/
    scraper/
      scraper.go (592 lines)
  go.mod (19 lines)
  hololive_channels.csv (74 lines)
  main.go (92 lines)
  README.md (119 lines)
client/
  app/
    add/
      page.tsx (1422 lines)
    analysis/
      page.tsx (283 lines)
    lib/
      channelIcons.ts (7 lines)
    livestreams/
      LivestreamModal.tsx (719 lines)
      page.tsx (852 lines)
    privacy/
      page.tsx (87 lines)
    terms/
      page.tsx (47 lines)
    globals.css (1292 lines)
    layout.tsx (27 lines)
    page.tsx (878 lines)
  public/
    file.svg (1 lines)
    globe.svg (1 lines)
    next.svg (1 lines)
    vercel.svg (1 lines)
    window.svg (1 lines)
  .gitignore (41 lines)
  eslint.config.mjs (18 lines)
  next.config.ts (29 lines)
  package.json (28 lines)
  postcss.config.mjs (7 lines)
  README.md (52 lines)
  tsconfig.json (34 lines)
deploy/
  jobs/
    api-migrate-job.yaml (27 lines)
  k8s/
    00-namespace.yaml (4 lines)
    05-configmap.yaml (21 lines)
    10-redis.yaml (41 lines)
    20-api.yaml (124 lines)
    30-app-client.yaml (62 lines)
    40-workers.yaml (92 lines)
    50-ingress.yaml (34 lines)
docs/
  adjustment-system-ui-checklist.md (39 lines)
  auth-verification-runbook.md (103 lines)
  bbb-implementation-analysis.md (645 lines)
  bbb-proposal.md (100 lines)
  nasfaq-games-architecture.md (621 lines)
  nasfaq-games-implementation-plan.md (801 lines)
  runbooks.md (10 lines)
  youtube-api-remediation-checklist.md (97 lines)
holonews/
  cmd/
    backfill-thumbnail-variants/
      main.go (245 lines)
    holonews/
      main_test.go (110 lines)
      main.go (1647 lines)
  internal/
    thumbs/
      thumbs.go (83 lines)
  reference_image_scraper/
    convert-reference-images.ps1 (92 lines)
    go.mod (10 lines)
    main.go (448 lines)
    README.md (37 lines)
  Dockerfile (14 lines)
  env.example (26 lines)
  go.mod (39 lines)
superchatscraper/
  cmd/
    clear-stream-tables/
      main.go (51 lines)
    drop-superchat-metadata-columns/
      main.go (47 lines)
    superchatscraper/
      main.go (320 lines)
  internal/
    db/
      db.go (138 lines)
      schema.go (6 lines)
      schema.sql (24 lines)
    hololyzer/
      client.go (301 lines)
  Dockerfile (14 lines)
  env.example (14 lines)
  go.mod (20 lines)
  README.md (59 lines)
ytscraper/
  cmd/
    backfill-channel-assets/
      main.go (401 lines)
    backfill-channel-metadata/
      main.go (128 lines)
    backfill-missing-daily-stats/
      main.go (397 lines)
    cleanup-upcoming-livestreams/
      main.go (155 lines)
    finalize-stuck-livestreams/
      main.go (193 lines)
    rewrite-channel-asset-urls/
      main.go (174 lines)
    ytchannels/
      main.go (178 lines)
    ytscraper/
      main.go (1169 lines)
  db/
    init.sql (262 lines)
  internal/
    db/
      db.go (664 lines)
      schema.go (6 lines)
      schema.sql (748 lines)
    livestreams/
      redis.go (143 lines)
      types.go (31 lines)
    youtube/
      client.go (596 lines)
  Dockerfile (14 lines)
  env.example (38 lines)
  go.mod (25 lines)
  README.md (145 lines)
.dockerignore (10 lines)
.gitignore (73 lines)
DEPLOYMENT.md (1310 lines)
go.work (9 lines)
go.work.sum (23 lines)
leaderboard.md (325 lines)
phase 1 lld.md (1522 lines)
PREDICTION_MARKET_DESIGN.md (795 lines)
PREDICTION_MARKET_IMPLEMENTATION_PLAN.md (686 lines)
start-tmux (3 lines)
todo.txt (42 lines)
```