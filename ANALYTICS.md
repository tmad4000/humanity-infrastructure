# Anonymous analytics

Umami at https://analytics.ideaflow.app uses product `humanity-infrastructure`.
Website UUID: `57b2fd1b-6e77-4536-9c87-798e3019c49d`.
Dashboard: https://analytics.ideaflow.app/websites/57b2fd1b-6e77-4536-9c87-798e3019c49d

The registered product map and the live wrapper's optional
`data-before-send` forwarding must be deployed from ideaflow-telemetry before
this client is released. A loaded script alone does not prove collection.

Automatic pageviews are enabled on /, /classic, /v2, /v3 and /v4. Private signup,
unsubscribe, export, and design gallery routes have no tracker. DNT is respected;
no cookies, identify calls, form values, query tokens, referrer paths, or arbitrary
page titles are collected. UTM source/ref values are restricted to x, twitter,
buzz, hi_newsletter, github and lastbook; medium to social/community/email/referral;
campaign to hi_launch_YYYYMM; content to reply_farbood_NN, reply_kevinrose_NN,
launch_post_NN, or issue_YYYYMMDD_primary. Other query fields are removed before
sending. Events contain only destination host, fixed placement, Lastbook listing
ID where applicable, and elapsed time. New campaign values need review here.

Events: resource_outbound_click (including Lastbook), github_click,
x_outbound_click, newsletter_signup_start and newsletter_signup. Signup success
is emitted only after the first-step API succeeds, once per form lifecycle;
optional details saves do not emit another signup. External clicks measure intent.

Release verification: normal browser UA on production, one pageview per page,
allowed UTM/referrer retained, query PII removed, outbound events once, signup
success only after success, DNT produces no ingestion, then read counts/events
back from Umami. Preserve signup bindings and secrets; deploy through coordinator.

Reserved interest events: `interest_want`, `interest_building`, and
`interest_tweet_intent`, with only public item_key and fixed placement. The
interest feature owns confirmed-success emission; never infer success from clicks.
Resource clicks carry the shelf listing_id; guide/suggest and legacy quest-claim
intent use distinct events. `ref=x-interest` is an approved share attribution.
