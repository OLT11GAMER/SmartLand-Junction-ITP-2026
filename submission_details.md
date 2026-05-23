# TokaIme Submission Details

## Project Name
TokaIme

## Punchline
AI-powered land intelligence for Kosovo: live parcel maps, farmer/admin views, and satellite-ready risk signals for fairer agricultural decisions.

## Description
TokaIme turns static cadastral land records into a living agricultural intelligence platform for Kosovo.

Today, institutions and farmers often work with fragmented parcel records, paper-heavy reporting, and slow field verification. This makes it hard to detect unused land, inflated subsidy claims, monoculture risk, crop stress, and changes in land use before they become expensive policy or production problems.

Our prototype demonstrates a shared digital workspace for two key users:

- Farmers can view their registered parcels, understand land-health signals, and receive AI-guided recommendations for crop rotation and next actions.
- Administrators can inspect Kosovo-wide parcel data, search by parcel/owner/municipality, open detailed parcel records, compare declared farmer information with satellite-style indicators, and prioritize parcels for follow-up.

The application includes:

- A React-based product prototype with login flows for farmer and administrator sample views.
- A connected HTML demo mode that shows the original high-fidelity concept screens.
- An interactive Kosovo map with parcel selection, synced sidebar search, hardcoded showcase parcel `KOS-LPJ-000613`, and richer parcel popups for judge demos.
- Mobile navigation for the admin map/detail panels.
- An Agriculture AI floating assistant that simulates analysis progress and produces practical land-health guidance.
- Kosovo administrative, land-use, water, and synthetic parcel data prepared for the prototype experience.

The current prototype uses demo intelligence and synthetic/sample parcel analytics to communicate the workflow. The production roadmap is designed around trusted earth-observation and land-monitoring sources:

- Copernicus Browser for Sentinel imagery search, visualization, and download.
- Copernicus Land Monitoring Service for land cover, land use, vegetation state, water-cycle, and land-surface variables.
- BigEarthNet / TU Berlin as a Sentinel benchmark dataset with 590,326 image patches across Europe, including Kosovo, for land-cover classification research.
- Crop-classification deep-learning references as direction for future crop prediction from satellite imagery.

TokaIme is built with React, Vite, Leaflet, MapLibre/Mapbox tooling, Turf.js, generated geospatial data, and a high-fidelity HTML demo layer. The result is a practical bridge between cadastral records, farmers, satellite intelligence, and government decision-making.

## Challenge Picker
SmartLand Challenge / Agriculture & Land Governance

## Project Demo
TODO: add deployed app URL.

Local demo while developing: http://localhost:5178/

## Source Code
https://github.com/OLT11GAMER/SmartLand-Junction-ITP-2026

## Video
TODO: add YouTube, Loom, or Drive demo link.

## Other Link
https://land.copernicus.eu/

## Presentation
Toka_Ime_AI_English_refined.pptx

## References For Judges
- Copernicus Browser: https://browser.dataspace.copernicus.eu/
- Copernicus Land Monitoring Service: https://land.copernicus.eu/
- Crop Classification reference: https://github.com/bhavesh907/Crop-Classification
- BigEarthNet v1: https://developers.google.com/earth-engine/datasets/catalog/TUBerlin_BigEarthNet_v1
