# Final tie runoff

Implemented plan:

1. Freeze the rule at game start with `tieRunoffRules`; preserve ongoing games.
2. Keep Police ranking for main-round ties that do not include Police.
3. Otherwise open one 60-second runoff restricted to tied candidates, retaining
   all eligible voters, no self-votes, immutable ballots and Communication Lock.
4. A repeated tie awards Killer Side victory. A unique nominee follows the usual
   Killer/Wife rules. Each main round has its own single runoff allowance.
5. Display the main round and runoff separately; update the in-game guide.
6. Verify the real SQL resolver, ballot validation, privacy, deadlines, Wife
   transition and migration compatibility with regression tests.

Storage uses ballot round IDs 1/2 for the two main rounds and 3/4 for their
respective runoffs. Public history records the main round plus a runoff marker.
The UI never labels the runoffs as main rounds three or four.

Deployment requires migration `20260912_final_tie_runoff.sql` after the Wife
revote migration, plus the updated web app. Existing active games retain their
starting rules. No live deployment is performed by this local change.

Balance tradeoff: unresolved ties now favor Killer Side. Playtest separately
before drawing conclusions about win rates. Police lineage elimination still
ends the game before Final under the existing rules.
