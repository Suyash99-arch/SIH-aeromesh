import { jsPDF } from 'jspdf';
import type { Incident } from '../types';

/**
 * Generate a complete, beautifully styled, printable AeroMesh Analysis Report
 * in actual PDF format (.pdf) using jsPDF and trigger an immediate file download.
 */
export function downloadIncidentReport(incident: Incident): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const stats = incident.stats || {
    totalPeople: 48,
    peopleDelta: 3,
    totalVehicles: 24,
    vehiclesDelta: 2,
    fireIncidents: { major: 1, minor: 1, hazardous: 1 },
    entryExitPoints: { total: 4, entry: 2, exit: 2 },
    damagedAreas: { total: 2, details: 'Bridge Section + Road' },
  };

  const detected = incident.detectedConditions || {
    structuralDamage: true,
    fire: true,
    smoke: true,
    humanPresence: true,
    vehiclePresence: true,
    entryExit: true,
  };

  const overall = incident.overallCondition || {
    level: 'CRITICAL',
    title: 'CRITICAL - Immediate attention recommended',
    description:
      'The analysed scene indicates significant structural damage with active fire activity and multiple detected entities. The affected area should be inspected and secured immediately.',
  };

  const observations = incident.keyObservations || [
    'Structural damage detected on the bridge section.',
    'Active fire detected near the roadway.',
    'Multiple vehicles identified in the affected zone.',
    'Human presence detected within the incident area.',
    'Multiple entry and exit points identified.',
  ];

  const pageWidth = 210;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 14;

  // ── 1. Top Header Banner ──────────────────────────────────────────────────
  // Deep navy header background
  doc.setFillColor(8, 16, 36);
  doc.roundedRect(margin, y, contentWidth, 24, 3, 3, 'F');

  // Brand Accent Bar
  doc.setFillColor(0, 210, 255);
  doc.rect(margin, y, 3, 24, 'F');

  // Brand Name & Subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text('AeroMesh Analysis Report', margin + 7, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text('Automated Aerial Reconnaissance & AI Vision Intelligence', margin + 7, y + 16);

  // Status Badge (Right side of header)
  const statusText = incident.status || 'Analysis Completed';
  const isCompleted = statusText.toLowerCase().includes('completed');
  if (isCompleted) {
    doc.setFillColor(6, 78, 59);
    doc.setDrawColor(16, 185, 129);
    doc.setTextColor(52, 211, 153);
  } else {
    doc.setFillColor(69, 26, 3);
    doc.setDrawColor(245, 158, 11);
    doc.setTextColor(251, 191, 36);
  }
  doc.roundedRect(pageWidth - margin - 48, y + 6, 44, 12, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`* ${statusText}`, pageWidth - margin - 45, y + 13.5);

  y += 28;

  // ── 2. Section: Incident Overview ─────────────────────────────────────────
  doc.setFillColor(2, 132, 199);
  doc.circle(margin + 2.5, y + 2, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('1', margin + 1.8, y + 2.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(14, 116, 144);
  doc.text('Incident Overview', margin + 8, y + 3);
  y += 6;

  // 4 Cards Grid for Overview
  const cardW = (contentWidth - 6) / 3;
  const cardH = 14;

  const overviewFields = [
    { label: 'INCIDENT ID', value: incident.id, color: [2, 132, 199] },
    { label: 'INCIDENT NAME', value: incident.name, color: [30, 41, 59] },
    { label: 'ANALYSIS STATUS', value: incident.status, color: isCompleted ? [16, 185, 129] : [245, 158, 11] },
    { label: 'LOCATION', value: incident.location, color: [30, 41, 59] },
    { label: 'DATE & TIME', value: `${incident.date}  *  ${incident.time}`, color: [30, 41, 59] },
    { label: 'VISION PLATFORM', value: 'AeroMesh v2.4 (Drone Network)', color: [71, 85, 105] },
  ];

  for (let i = 0; i < overviewFields.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = margin + col * (cardW + 3);
    const cy = y + row * (cardH + 2);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(overviewFields[i].label, cx + 3, cy + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const [r, g, b] = overviewFields[i].color;
    doc.setTextColor(r, g, b);
    const truncatedVal = doc.splitTextToSize(overviewFields[i].value, cardW - 6)[0] || '';
    doc.text(truncatedVal, cx + 3, cy + 10.5);
  }

  y += 2 * (cardH + 2) + 6;

  // ── 3. Section: Entity Detection Summary ──────────────────────────────────
  doc.setFillColor(2, 132, 199);
  doc.circle(margin + 2.5, y + 2, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('2', margin + 1.8, y + 2.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(14, 116, 144);
  doc.text('Entity Detection Summary', margin + 8, y + 3);
  y += 6;

  const statCols = 7;
  const statW = (contentWidth - (statCols - 1) * 2) / statCols;
  const statH = 18;

  const statItems = [
    { label: 'People', val: `${stats.totalPeople}`, sub: `+${stats.peopleDelta} detected`, subColor: [16, 185, 129] },
    { label: 'Vehicles', val: `${stats.totalVehicles}`, sub: `+${stats.vehiclesDelta} detected`, subColor: [16, 185, 129] },
    {
      label: 'Fire Incidents',
      val: `${stats.fireIncidents.major + stats.fireIncidents.minor + stats.fireIncidents.hazardous}`,
      sub: `Maj:${stats.fireIncidents.major} Min:${stats.fireIncidents.minor}`,
      subColor: [225, 29, 72],
    },
    { label: 'Smoke', val: '5', sub: '+1 isolated', subColor: [2, 132, 199] },
    { label: 'Damaged Areas', val: `${stats.damagedAreas.total}`, sub: 'Bridge + Road', subColor: [217, 119, 6] },
    { label: 'Entry Points', val: `${stats.entryExitPoints.entry}`, sub: 'Clear', subColor: [2, 132, 199] },
    { label: 'Exit Points', val: `${stats.entryExitPoints.exit}`, sub: 'Clear', subColor: [2, 132, 199] },
  ];

  for (let i = 0; i < statItems.length; i++) {
    const sx = margin + i * (statW + 2);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(sx, y, statW, statH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(statItems[i].label, sx + statW / 2, y + 4.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(statItems[i].val, sx + statW / 2, y + 11, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.5);
    const [sr, sg, sb] = statItems[i].subColor;
    doc.setTextColor(sr, sg, sb);
    doc.text(statItems[i].sub, sx + statW / 2, y + 15.5, { align: 'center' });
  }

  y += statH + 6;

  // ── 4. Section: Detected Conditions ───────────────────────────────────────
  doc.setFillColor(2, 132, 199);
  doc.circle(margin + 2.5, y + 2, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('3', margin + 1.8, y + 2.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(14, 116, 144);
  doc.text('Detected Conditions', margin + 8, y + 3);
  y += 6;

  const condCols = 3;
  const condW = (contentWidth - (condCols - 1) * 3) / condCols;
  const condH = 10;

  const conditionList = [
    { title: 'Structural Damage', detected: detected.structuralDamage },
    { title: 'Fire Activity', detected: detected.fire },
    { title: 'Smoke Plumes', detected: detected.smoke },
    { title: 'Human Presence', detected: detected.humanPresence },
    { title: 'Vehicle Presence', detected: detected.vehiclePresence },
    { title: 'Entry / Exit Points', detected: detected.entryExit },
  ];

  for (let i = 0; i < conditionList.length; i++) {
    const col = i % condCols;
    const row = Math.floor(i / condCols);
    const cnx = margin + col * (condW + 3);
    const cny = y + row * (condH + 2);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cnx, cny, condW, condH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text(conditionList[i].title, cnx + 3, cny + 6.5);

    const isDet = conditionList[i].detected;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    if (isDet) {
      doc.setTextColor(16, 185, 129);
      doc.text('[* Detected]', cnx + condW - 3, cny + 6.5, { align: 'right' });
    } else {
      doc.setTextColor(148, 163, 184);
      doc.text('[-- None]', cnx + condW - 3, cny + 6.5, { align: 'right' });
    }
  }

  y += 2 * (condH + 2) + 6;

  // ── 5. Section: Overall Condition (Critical Banner) ───────────────────────
  doc.setFillColor(2, 132, 199);
  doc.circle(margin + 2.5, y + 2, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('4', margin + 1.8, y + 2.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(14, 116, 144);
  doc.text('Overall Condition Assessment', margin + 8, y + 3);
  y += 6;

  doc.setFillColor(254, 242, 242);
  doc.setDrawColor(244, 63, 94);
  doc.roundedRect(margin, y, contentWidth, 19, 2, 2, 'FD');

  // Red alert icon / tag
  doc.setFillColor(225, 29, 72);
  doc.roundedRect(margin + 3, y + 3, 20, 5.5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);
  doc.text(overall.level || 'CRITICAL', margin + 13, y + 6.8, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(159, 18, 57);
  doc.text(overall.title || 'Immediate attention recommended', margin + 26, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const descLines = doc.splitTextToSize(overall.description, contentWidth - 8);
  doc.text(descLines, margin + 4, y + 13.5);

  y += 24;

  // ── 6. Section: Key Observations ──────────────────────────────────────────
  doc.setFillColor(2, 132, 199);
  doc.circle(margin + 2.5, y + 2, 2.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text('5', margin + 1.8, y + 2.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(14, 116, 144);
  doc.text('Key Observations', margin + 8, y + 3);
  y += 7;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  const obsBoxH = observations.length * 6.5 + 4;
  doc.roundedRect(margin, y, contentWidth, obsBoxH, 2, 2, 'FD');

  let obsY = y + 5;
  for (let i = 0; i < observations.length; i++) {
    doc.setFillColor(0, 210, 255);
    doc.circle(margin + 5, obsY - 0.7, 1.2, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(observations[i], margin + 9, obsY);
    obsY += 6.5;
  }

  // ── 7. Footer ─────────────────────────────────────────────────────────────
  const footerY = 286;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('Generated by AeroMesh Vision Engine v2.4  *  Confidential Incident Record', margin, footerY);

  const printDate = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.text(`${printDate}  |  Page 1 of 1`, pageWidth - margin, footerY, { align: 'right' });

  // Save PDF file directly to client
  doc.save(`AeroMesh_Report_${incident.id}.pdf`);
}
