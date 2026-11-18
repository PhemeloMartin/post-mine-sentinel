# Standard operating procedure: S.P.I.D.E.R. field deployment

**Safety is non-negotiable. No one enters any shaft, adit or underground working under this SOP.**

## 1. Before going to site
* Daylight only, with a minimum of **two people**. Notify the regional SOC and SAPS of the visit. Check the site's latest alert status (no deployment at sites with an active alert).
* Inspect the kit: nodes provisioned (site and node IDs, key ID recorded; keys loaded from the secure provisioning station, never typed by hand); batteries charged; firmware version matches the release.

## 2. On site
1. Keep at least 10 m from collars and unfenced openings. Treat all ground near shafts as unstable (subsidence and hidden holings).
2. Mount anchors first (headframe crown only by certified rope-access personnel; otherwise the mast anchor), then confirm back-haul.
3. Place spiders according to the layout plan: headframe legs, collar, fence posts, ruins, rocks along access paths, and the tailings edge. Spikes must be firmly coupled to steel or rock.
4. Record each node's **GPS position (±1 m RTK where available)** and a photo of its concealment. Positions feed TDOA.
5. Verify each node joins the mesh (console → SilkNet) and reports a heartbeat.

## 3. Commissioning
* A 48-hour commissioning period: alerts are muted to "observation"; background statistics and thresholds are learned; analysts review all triggers.
* Sign-off by the regional SOC lead before alerts go live.

## 4. Maintenance and recovery
* Battery or panel service per the console's battery forecast. Tampered or stolen nodes are reported as incidents, and their keys are revoked.
* Decommissioning: recover all devices; wipe keys (secure element `lock`); update the asset register.
