import { expect, test } from "@playwright/test";

test.describe("AeroMesh Mission & Analysis Workflows", () => {
  // 1. Application loads and reaches backend
  test("1. application loads and reaches the backend mission API", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /AI-Powered UAV Damage Detection/i })).toBeVisible();

    const missionsResponse = await page.evaluate(async () => {
      const response = await fetch("http://127.0.0.1:8000/api/missions");
      return { status: response.status, success: (await response.json()).success };
    });

    expect(missionsResponse).toEqual({ status: 200, success: true });
  });

  // 2. Mission flow creation test (existing test preserved)
  test("2. opens the mission flow and validates required mission name", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start New Mission" }).first().click({ force: true });
    await expect(page.getByRole("heading", { name: "Create New Mission" })).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Mission name is required");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Next: Video Upload" }).click({ force: true });
    await expect(page.getByRole("heading", { name: "Mission Setup" })).toBeVisible();
  });

  // 3-11: Phase 8 Professional 3D / GIS Mission Analysis Workspace tests
  test("3-11. validates Phase 8 3D workspace, reconstruction status, layers, search, details, calibration, and video link", async ({ page }) => {
    // Navigate to homepage
    await page.goto("/");

    // Enter Dashboard
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();

    // Navigate to 3D Reconstruction Analysis Workspace
    await page.getByRole("button", { name: /3D Reconstruction/i }).click();

    // 3. 3D viewer container renders
    const workspace = page.locator("#mission-analysis-workspace");
    await expect(workspace).toBeVisible();
    await expect(page.locator(".reconstruction-canvas")).toBeVisible();

    // 4. Reconstruction status appears
    await expect(page.getByText(/Reconstruction Status/i).first()).toBeVisible();
    await expect(page.getByText(/Sparse Points/i).first()).toBeVisible();
    await expect(page.locator(".recon-stat-label", { hasText: "Surface Mesh" })).toBeVisible();

    // 10. Relative-scale disclosure appears prominently
    const scaleBadge = page.locator("#scale-disclosure-badge");
    await expect(scaleBadge).toBeVisible();
    await expect(scaleBadge).toContainText(/RELATIVE SCALE|METRIC SCALE/);

    // 5. Layer toggle works
    const meshCheckbox = page.locator("label:has-text('Surface Mesh') input[type='checkbox']");
    await expect(meshCheckbox).toBeVisible();
    await expect(meshCheckbox).toBeChecked();
    await meshCheckbox.uncheck();
    await expect(meshCheckbox).not.toBeChecked();
    await meshCheckbox.check();
    await expect(meshCheckbox).toBeChecked();

    // 9. Measurement tools appear in bottom toolbar
    const toolbar = page.locator(".analysis-bottom-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Select" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Distance" })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Calibrate" })).toBeVisible();

    // 6. Object list/search works
    const searchInput = page.locator(".object-search-input");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("T0001");
    await expect(page.locator(".object-scroll-list")).toContainText(/T0001/);

    // 7. Selecting an object opens details
    const objectCard = page.locator(".object-list-item").first();
    await objectCard.click();
    await expect(page.locator(".inspector-header")).toBeVisible();
    await expect(page.locator(".object-coord-box")).toBeVisible();
    await expect(page.getByText("LOCAL_ARBITRARY").first()).toBeVisible();

    // 11. Source-video action is available for supported objects
    const viewVideoBtn = page.locator("#btn-view-source-video");
    await expect(viewVideoBtn).toBeVisible();
    await viewVideoBtn.click();
    // Modal opens showing reprojection and video frame
    await expect(page.locator(".analysis-modal-content")).toBeVisible();
    await expect(page.getByText("Reprojection Diagnostics")).toBeVisible();
    // Close modal
    await page.locator(".analysis-modal-close").click();
    await expect(page.locator(".analysis-modal-content")).not.toBeVisible();

    // 8. Calibration panel opens
    await toolbar.getByRole("button", { name: "Calibrate" }).click();
    await expect(page.getByText(/Photogrammetric Scale Calibration/i)).toBeVisible();
    await expect(page.getByText(/Known Distance/i)).toBeVisible();
  });

  // 12-18: Phase 9 Professional Reports & Exports Workspace tests
  test("12-18. validates Phase 9 Reports & Exports workspace, report summary, PDF, CSV, JSON, GeoJSON refusal, and Evidence Package controls", async ({ page }) => {
    await page.goto("/");

    // Enter Dashboard
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();

    // Navigate to Reports
    await page.getByRole("button", { name: "Reports" }).click();

    // 1. Reports page loads
    await expect(page.getByRole("heading", { name: /Mission Reports & Exports/i })).toBeVisible();

    // 2. Real report summary appears
    await expect(page.locator(".reports-header-card")).toBeVisible();
    await expect(page.locator(".reports-disclosure-box")).toBeVisible();
    await expect(page.getByText(/LOCAL_ARBITRARY/).first()).toBeVisible();
    await expect(page.getByText(/RELATIVE_SCALE/).first()).toBeVisible();
    await expect(page.getByText(/Report Summary Preview/i)).toBeVisible();

    // 3. PDF export control appears
    const pdfBtn = page.getByRole("link", { name: /Download PDF/i });
    await expect(pdfBtn).toBeVisible();
    await expect(pdfBtn).toHaveAttribute("href", /.*\/report\/pdf$/);

    // 4. CSV export control appears
    const csvBtn = page.getByRole("link", { name: /Download CSV/i });
    await expect(csvBtn).toBeVisible();
    await expect(csvBtn).toHaveAttribute("href", /.*\/export\/csv$/);

    // 5. JSON export control appears
    const jsonBtn = page.getByRole("link", { name: /Download JSON/i });
    await expect(jsonBtn).toBeVisible();
    await expect(jsonBtn).toHaveAttribute("href", /.*\/export\/json$/);

    // 6. GeoJSON unavailable state appears for unreferenced mission
    await expect(page.getByText(/Unavailable — mission is not georeferenced/i)).toBeVisible();
    const geoBtn = page.getByRole("button", { name: /Download GeoJSON \(Unavailable\)/i });
    await expect(geoBtn).toBeVisible();
    await expect(geoBtn).toBeDisabled();

    // 7. Evidence package control appears
    const pkgBtn = page.getByRole("link", { name: /Download Evidence Package/i });
    await expect(pkgBtn).toBeVisible();
    await expect(pkgBtn).toHaveAttribute("href", /.*\/export\/package$/);

    // Test preview tab switching
    await page.locator(".report-tab-btn", { hasText: "Detection" }).click();
    await expect(page.getByText(/yolo11n/i).first()).toBeVisible();

    await page.locator(".report-tab-btn", { hasText: "Reconstruction" }).click();
    await expect(page.getByText(/Registered Cameras/i).first()).toBeVisible();

    await page.locator(".report-tab-btn", { hasText: "3D Fusion" }).click();
    await expect(page.getByText(/AI-to-3D Multi-View Spatial Fusion/i).first()).toBeVisible();
  });
});