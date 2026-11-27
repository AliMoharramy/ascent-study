# Glossary

## Personal task

A short, user-created task stored in the Ascent account's PostgreSQL database. The task belongs to one account, appears in the widget's **Mine** tab, and can be marked open or done from any connected client.

## AI task suggestion

One proposed next action generated from the account's open Today, Courses, and Mine task counts and today's focus minutes. The suggestion can be started as a focus block or copied into Mine. Personal task titles are excluded from provider requests by default; the account preference `shareTaskTitlesWithAi` must be explicitly enabled before the server may include up to 16 open titles.

## AI-assisted study log

A user-submitted record of a study session with its topic and notes or transcript. Each submission or retry requires explicit consent before the topic and source text may be sent to the configured AI provider; course, lesson/video, and chapter references remain local. Recording a focus session never creates or changes a study log.

## Fixed study review

One source-grounded cloze prompt and answer scheduled by the server for +3, +7, +14, or +30 calendar days after a study log's date. Filling the prompt's single blank with its answer must reproduce the cited source excerpt. Due reviews remain visible in Forge even when reminders are disabled or capped.

## Native focus session

A server-owned Ascent focus session controlled by the Windows widget through the website's authenticated `/api/focus` endpoint. The widget displays a local 25-minute countdown derived from the server's elapsed milliseconds; the server remains authoritative for running/paused state and recorded focus time.
