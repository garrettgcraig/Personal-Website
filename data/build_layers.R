# build_layers.R
# Downloads, processes, and simplifies boundary data for:
#   1. Wilderness Areas (from wilderness.net) — dissolved by name
#   2. National Park Service units (from NPS ArcGIS REST)
#   3. National Forests (from USFS)
# Outputs individual GeoJSON files for each layer.

library(sf)
library(dplyr)

data_dir <- getwd()
message("Output directory: ", data_dir)

# ── Helper: simplify + project ───────────────────────────────────────────
simplify_sf <- function(sf_obj, tol = 500) {
  sf_obj |>
    st_transform(5070) |>
    st_simplify(dTolerance = tol) |>
    st_transform(4326) |>
    st_make_valid()
}

# ══════════════════════════════════════════════════════════════════════════
# 1. WILDERNESS AREAS — dissolve by name
# ══════════════════════════════════════════════════════════════════════════
wild_path <- file.path(data_dir, "wilderness.geojson")
if (!file.exists(wild_path)) {
  message("\n=== Wilderness Areas ===")
  zip_path <- tempfile(fileext = ".zip")
  download.file("https://www.wilderness.net/GIS/Wilderness_Areas.zip", zip_path, mode = "wb")
  shp_dir <- tempdir()
  unzip(zip_path, exdir = shp_dir)
  shp_file <- list.files(shp_dir, "\\.shp$", full.names = TRUE, recursive = TRUE)
  wild <- st_read(shp_file[1], quiet = TRUE)
  message("  Raw features: ", nrow(wild))
  message("  Columns: ", paste(names(wild), collapse = ", "))

  # Dissolve by NAME (merges multi-agency wilderness units)
  wild_dissolved <- wild |>
    group_by(NAME) |>
    summarise(
      acres = sum(as.numeric(Acreage), na.rm = TRUE),
      state = paste(unique(STATE), collapse = ", "),
      agency = paste(unique(Agency), collapse = ", "),
      designated = min(Designated, na.rm = TRUE),
      .groups = "drop"
    ) |>
    st_make_valid()

  message("  After dissolve: ", nrow(wild_dissolved), " unique wilderness areas")

  wild_clean <- simplify_sf(wild_dissolved) |>
    transmute(
      name = NAME,
      acres = round(acres),
      state,
      agency,
      designated,
      type = "wilderness"
    )

  st_write(wild_clean, wild_path, driver = "GeoJSON", delete_dsn = TRUE)
  message("  Wrote: ", wild_path, " (", nrow(wild_clean), " features)")
} else {
  message("Wilderness GeoJSON already exists, skipping.")
}

# ══════════════════════════════════════════════════════════════════════════
# 2. NATIONAL PARK SERVICE UNITS
# ══════════════════════════════════════════════════════════════════════════
nps_path <- file.path(data_dir, "nps.geojson")
if (!file.exists(nps_path)) {
  message("\n=== NPS Units ===")

  # Use esri2sf to pull from the NPS ArcGIS REST service
  # NPS Boundary service: https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2
  nps_url <- "https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2"

  nps <- esri2sf::esri2sf(nps_url)
  message("  Raw features: ", nrow(nps))
  message("  Columns: ", paste(names(nps), collapse = ", "))

  # Keep relevant park-type units (National Parks, Monuments, Seashores, etc.)
  # Compute acres from Shape__Area (in square meters) if GIS_Acres not present
  nps_clean <- simplify_sf(nps, tol = 500) |>
    transmute(
      name = UNIT_NAME,
      code = UNIT_CODE,
      designation = UNIT_TYPE,
      state = STATE,
      acres = if ("GIS_Acres" %in% names(nps)) round(as.numeric(GIS_Acres))
              else if ("Shape__Area" %in% names(nps)) round(as.numeric(Shape__Area) / 4046.86)
              else NA_integer_,
      type = "nps"
    )

  st_write(nps_clean, nps_path, driver = "GeoJSON", delete_dsn = TRUE)
  message("  Wrote: ", nps_path, " (", nrow(nps_clean), " features)")
} else {
  message("NPS GeoJSON already exists, skipping.")
}

# ══════════════════════════════════════════════════════════════════════════
# 3. NATIONAL FORESTS
# ══════════════════════════════════════════════════════════════════════════
nf_path <- file.path(data_dir, "national_forests.geojson")
if (!file.exists(nf_path)) {
  message("\n=== National Forests ===")

  # Use esri2sf from the USFS ArcGIS REST service
  nf_url <- "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0"

  nf <- esri2sf::esri2sf(nf_url)
  message("  Raw features: ", nrow(nf))
  message("  Columns: ", paste(names(nf), collapse = ", "))

  nf_clean <- simplify_sf(nf, tol = 600) |>
    transmute(
      name = FORESTNAME,
      region = REGION,
      acres = if ("GIS_ACRES" %in% names(nf)) round(as.numeric(GIS_ACRES))
              else if ("SHAPEAREA" %in% names(nf)) round(as.numeric(SHAPEAREA) / 4046.86)
              else NA_integer_,
      type = "national_forest"
    )

  st_write(nf_clean, nf_path, driver = "GeoJSON", delete_dsn = TRUE)
  message("  Wrote: ", nf_path, " (", nrow(nf_clean), " features)")
} else {
  message("National Forests GeoJSON already exists, skipping.")
}

message("\n=== Done ===")
message("Files:")
for (f in c(wild_path, nps_path, nf_path)) {
  if (file.exists(f)) {
    sz <- file.size(f) / 1024 / 1024
    message("  ", basename(f), " — ", round(sz, 1), " MB")
  }
}
