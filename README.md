# Reward Request Scheduler

  Sends the specified request exactly at the TARGET_TIMES times from config file. TARGET_TIMES sample:
  - 19:59:59
  - 20:00:00
  - 20:00:01
  - 20:00:02
  - 20:00:03
  - 20:00:04
  - 20:00:05

  For each configured user token, the request will be sent once at each time (7 total per user).

  Usage:
    USER1_TOKEN=token1 USER2_TOKEN=token2 node rewardScheduler.js
    # or provide a comma-separated list
    TOKENS=token1,token2 node rewardScheduler.js

  Notes:
  - Calibrates against the destination server's clock using the HTTP Date header.
  - Optional env SERVER_TZ_MINUTES lets you define server's timezone offset from UTC (e.g., +04:30 => 210).
  - If a target time has already passed today on the server clock, it will be scheduled for tomorrow.