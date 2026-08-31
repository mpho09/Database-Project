# Why the table is shaped this way

I used the USGS feature `id` (e.g. `us7000abcd`) as the primary key instead of an
auto-incrementing integer, because it's the one stable identifier USGS gives every
event — that's what lets `ON CONFLICT (id) DO UPDATE` actually recognize "this is the
same earthquake I saw an hour ago" instead of inserting a duplicate row every time the
script re-runs. I split `latitude`/`longitude`/`depth_km` into their own numeric
columns rather than storing GeoJSON coordinates as a single string, since the webpage
needs to filter/sort on magnitude and I wanted the raw numbers available for the
stretch goal (passing lat/lng straight into the Open-Meteo API without parsing a
string first). `event_time` is stored as `timestamptz` (converted from the epoch-ms
value USGS sends) so it sorts and displays correctly regardless of timezone, and
`fetched_at` is separate from `event_time` so I can tell "when did the quake happen"
apart from "when did my script last see it." The two weather columns are nullable
because they're only populated for the top 20 quakes by magnitude — calling a free
weather API for every single row in the daily feed felt unnecessary and slow.
