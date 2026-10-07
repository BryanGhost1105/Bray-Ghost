# New-business lead-source review — 2026-10-07

## Requirement

Find businesses that have recently begun operating, have no website, and can be added to Coldstart with usable provenance. “Recently added to a directory” is not the same fact as “recently opened.” An absent website URL in a listing means only “not listed there”; it does not establish that the business has no website.

## Candidate review

| Source | What the source can establish | Retention / cost / fit | Decision |
|---|---|---|---|
| Google Places | Its `openingDate` field concerns an anticipated future opening and is populated for `FUTURE_OPENING`; it does not provide a reliable recent-past opening date. | Places content has storage restrictions; Coldstart already has an unresolved persistence issue for Places-derived fields. | Do not expand persisted Places ingestion for this feature. |
| BusinessList.com.ng | Homepage shows entries marked `NEW` or `UPDATED`; those labels/date stamps describe directory activity, not independently verified opening dates. | Its Data Hub Pro page lists $25/month and explicitly says view-only/no export; Data Hub terms prohibit automated extraction except as a plan expressly allows. Website terms also prohibit automated access and commercial exploitation of directory data outside a business profile. | Not a usable automatic source or zero-cost export path. Do not scrape or transcribe it into Coldstart. |
| FisherLeads | Tracks businesses when a new website goes live, including Nigerian web businesses; its feed is useful for new-site launches, not businesses without a website. | API access is paid (the current pricing/docs distinguish plan access; the advertised API is on higher tiers). Even if its retained exports are licensed for internal business use, this is the opposite prospect condition and outside the current zero-budget constraint. | Do not add as a source for this use case. Revisit only if the offer changes to newly launched sites and the user approves spend. |
| OpenStreetMap (OSM) | `start_date` is documented for when an existing feature began; `opening_date` is for a planned future opening. A business feature without an OSM `website` tag is only “no website recorded in OSM.” | ODbL permits commercial use with attribution and share-alike obligations for qualifying derivative databases/public use. Port Harcourt’s boundary is available as OSM relation 3720765. A narrow Overpass query for business-tagged `start_date` objects with no website timed out at the server, so usable coverage is unverified. | Best no-cost candidate to test next, but do not integrate until a small sample can be retrieved and the ODbL treatment of Coldstart’s retained lead records is settled. |

## Evidence reviewed

- [Google Places REST reference](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places) — `openingDate` and `businessStatus` field semantics.
- [Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) — retention restrictions.
- [BusinessList new/updated listings](https://www.businesslist.com.ng/) and [Data Hub plan](https://www.businesslist.com.ng/saas) — current visible labels, $25/month view-only tier, no exports.
- [BusinessList website terms](https://www.businesslist.com.ng/terms-of-use) and [Data Hub terms](https://www.businesslist.com.ng/saas/terms) — automated collection restrictions.
- [FisherLeads Nigeria launch feed](https://fisherleads.com/new/country/ng), [pricing](https://fisherleads.com/), [API docs](https://fisherleads.com/docs), and [terms](https://fisherleads.com/terms) — new live websites, paid access/API tiers, and licensed-use limits.
- [OSM `start_date` key](https://wiki.openstreetmap.org/wiki/Key:start_date), [OSM `opening_date` key](https://wiki.openstreetmap.org/wiki/Key:opening_date), [ODbL use cases](https://wiki.openstreetmap.org/wiki/License/Use_Cases), and [Overpass API usage guidance](https://wiki.openstreetmap.org/wiki/Overpass_API).
- Read-only Nominatim returned Port Harcourt relation `3720765` and bounds `4.7131690, 6.9403250, 4.8240652, 7.0781333`. The follow-up Overpass query timed out; no candidate records were imported or stored.

## Next validation gate

Before an OSM connector is built, retrieve and review a small bounded sample for one user-selected market, verify that each `start_date` applies to the business feature rather than its building, verify no official website independently, retain OSM object/source IDs and attribution, and get a clear ODbL decision for how retained records are licensed. If coverage is too sparse, keep evidence-linked manual intake and pursue owner-submitted/referral sources rather than guessing.
