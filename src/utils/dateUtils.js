/**
 * Timezone and Date utilities for Cirota Backend (IST / Asia/Kolkata)
 */

function getNowIST() {
  const now = new Date();
  // Adjust to IST offset (+5.5h) if needed, or work with local/UTC standard
  return now;
}

function normalizeToStartOfDay(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function normalizeToEndOfDay(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function getDayOfWeekShort(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  // Mon, Tue, Wed, Thu, Fri, Sat, Sun
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[d.getDay()];
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function formatDateIST(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  return d.toISOString().split('T')[0];
}

module.exports = {
  getNowIST,
  normalizeToStartOfDay,
  normalizeToEndOfDay,
  getDayOfWeekShort,
  getDaysInMonth,
  formatDateIST,
};
