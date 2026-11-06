
// The Image Library includes historical records, not one picture per day.
const earliestDate = '1920-01-01';

// Get today's date in YYYY-MM-DD format (required by date inputs)
const today = new Date().toISOString().split('T')[0];

function setupDateInputs(startInput, endInput) {
  // Keep the search within the library's supported years.
  startInput.min = earliestDate;
  startInput.max = today;
  endInput.min = earliestDate;
  endInput.max = today;

  // A full year is more likely to contain nine matching image records.
  const previousYear = Number(today.slice(0, 4)) - 1;
  startInput.value = `${previousYear}-01-01`;
  endInput.value = `${previousYear}-12-31`;
}
