const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_SHIFT_LENGTH_MINUTES = 8 * 60 + 30;
const SHIFT_LENGTH_OPTIONS = Array.from({ length: 24 }, (_, index) => (index + 1) * 30);

const shiftRows = document.querySelector("#shift-rows");
const resultRows = document.querySelector("#result-rows");
const resultTable = document.querySelector("#result-table");
const statusMessage = document.querySelector("#status-message");
const scheduleCalendar = document.querySelector("#schedule-calendar");
const tableViewButton = document.querySelector("#table-view-button");
const calendarViewButton = document.querySelector("#calendar-view-button");
const deleteSelectedShiftsButton = document.querySelector("#delete-selected-shifts");
const sourceTimezone = "fixed:-300";
const destinationTimezone = "fixed:330";
let timeFormat = "24";
let timeFieldId = 0;
let shiftRowId = 0;
let scheduleView = "calendar";
const localTodayParts = getZonedParts(Date.now(), destinationTimezone);
let scheduleVisibleMonth = `${localTodayParts.year}-${String(localTodayParts.month).padStart(2, "0")}`;
const scheduledShifts = new Map();
const selectedScheduleEntries = new Set();

function getFixedOffset(timezone) {
  return timezone.startsWith("fixed:") ? Number(timezone.slice(6)) : null;
}

function getZonedParts(timestamp, timezone) {
  const fixedOffset = getFixedOffset(timezone);
  const date = new Date(timestamp + (fixedOffset ?? 0) * 60_000);
  if (fixedOffset !== null) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function formatZoneDate(timestamp, timezone) {
  const parts = getZonedParts(timestamp, timezone);
  return dateFormatter.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

function formatZoneTime(timestamp, timezone) {
  const parts = getZonedParts(timestamp, timezone);
  const hour24 = parts.hour;
  const hours =
    timeFormat === "24"
      ? String(hour24).padStart(2, "0")
      : String(hour24 % 12 || 12).padStart(2, "0");
  const minutes = String(parts.minute).padStart(2, "0");
  return timeFormat === "24"
    ? `${hours}:${minutes}`
    : `${hours}:${minutes} ${hour24 < 12 ? "AM" : "PM"}`;
}

function wallTimeToTimestamp(dateValue, minutesInDay, timezone) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const desiredTimestamp = Date.UTC(year, month - 1, day) + minutesInDay * 60_000;
  const fixedOffset = getFixedOffset(timezone);
  if (fixedOffset !== null) return desiredTimestamp - fixedOffset * 60_000;

  let timestamp = desiredTimestamp;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = getZonedParts(timestamp, timezone);
    const representedTimestamp = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const difference = desiredTimestamp - representedTimestamp;
    if (difference === 0) return timestamp;
    timestamp += difference;
  }

  const finalParts = getZonedParts(timestamp, timezone);
  if (
    finalParts.year !== new Date(desiredTimestamp).getUTCFullYear() ||
    finalParts.month !== new Date(desiredTimestamp).getUTCMonth() + 1 ||
    finalParts.day !== new Date(desiredTimestamp).getUTCDate() ||
    finalParts.hour !== new Date(desiredTimestamp).getUTCHours() ||
    finalParts.minute !== new Date(desiredTimestamp).getUTCMinutes()
  ) {
    return null;
  }
  return timestamp;
}

function createShiftRow(values = {}) {
  const rowsContainer = shiftRows.closest(".table-scroll");
  const initialRowsContainerHeight = rowsContainer?.getBoundingClientRect().height ?? 0;
  Array.from(shiftRows.rows).forEach((existingRow) => {
    existingRow.classList.add("shift-row-collapsed");
    existingRow.classList.add("shift-row-has-next");
    const toggleButton = existingRow.querySelector(".shift-row-toggle");
    if (toggleButton) {
      toggleButton.hidden = false;
      toggleButton.setAttribute("aria-expanded", "false");
      toggleButton.setAttribute("aria-label", `Expand shift ${existingRow.dataset.shiftId}`);
      toggleButton.querySelector(".shift-row-toggle-icon").textContent = "▸";
    }
  });

  const row = document.createElement("tr");
  row.dataset.shiftId = String(++shiftRowId);
  const dateCell = document.createElement("td");
  const startCell = document.createElement("td");
  const endCell = document.createElement("td");
  const actionCell = document.createElement("td");

  const dateCalendar = document.createElement("div");
  dateCalendar.className = "date-calendar";
  const rowSummary = document.createElement("div");
  rowSummary.className = "shift-row-summary";
  const summaryText = document.createElement("span");
  summaryText.className = "shift-row-summary-text";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "shift-row-toggle";
  toggleButton.hidden = true;
  toggleButton.setAttribute("aria-expanded", "false");
  const toggleIcon = document.createElement("span");
  toggleIcon.className = "shift-row-toggle-icon";
  toggleIcon.setAttribute("aria-hidden", "true");
  const updateToggleButton = () => {
    const isExpanded = !row.classList.contains("shift-row-collapsed");
    toggleButton.setAttribute("aria-expanded", String(isExpanded));
    toggleButton.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} shift ${row.dataset.shiftId}`);
    toggleIcon.textContent = isExpanded ? "▾" : "▸";
  };
  toggleButton.addEventListener("click", () => {
    row.classList.toggle("shift-row-collapsed");
    updateToggleButton();
    if (!row.classList.contains("shift-row-collapsed")) {
      row.querySelector('[data-role="start"] input')?.focus();
    }
  });
  toggleButton.append(summaryText, toggleIcon);
  rowSummary.append(toggleButton);
  const resetDatesButton = document.createElement("button");
  resetDatesButton.type = "button";
  resetDatesButton.className = "button button-secondary reset-dates";
  resetDatesButton.textContent = "Reset dates";
  resetDatesButton.addEventListener("click", () => {
    row.dataset.selectedDates = "[]";
    row.dataset.visibleMonth = getOfficeToday().slice(0, 7);
    setTimeValue(row.querySelector('[data-role="start"]'), null);
    setTimeValue(row.querySelector('[data-role="end"]'), null);
    setShiftLength(DEFAULT_SHIFT_LENGTH_MINUTES);
    renderCalendar(dateCalendar, row);
    updateShiftRowSummary(row);
    renderResults();
  });
  const initialDates = values.dates ?? [];
  row.dataset.visibleMonth = (initialDates[0] ?? getOfficeToday()).slice(0, 7);
  row.dataset.selectedDates = JSON.stringify(initialDates);

  const startInput = createTimeField("start", "Start time in office time zone", values.start);
  const endInput = createTimeField("end", "End time in office time zone", values.end);
  const shiftLengthControl = document.createElement("div");
  shiftLengthControl.className = "shift-length-control";
  const shiftLength = document.createElement("button");
  shiftLength.type = "button";
  shiftLength.className = "shift-length";
  shiftLength.setAttribute("aria-haspopup", "listbox");
  shiftLength.setAttribute("aria-expanded", "false");
  const shiftLengthMenu = document.createElement("div");
  shiftLengthMenu.className = "shift-length-menu";
  shiftLengthMenu.id = `shift-length-options-${row.dataset.shiftId}`;
  shiftLengthMenu.setAttribute("role", "listbox");
  shiftLengthMenu.setAttribute("aria-label", "Shift time");
  shiftLength.setAttribute("aria-controls", shiftLengthMenu.id);
  const shiftLengthMenuTitle = document.createElement("strong");
  shiftLengthMenuTitle.className = "shift-length-menu-title";
  shiftLengthMenuTitle.textContent = "Shift time";
  shiftLengthMenu.append(shiftLengthMenuTitle);

  const formatShiftLength = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return [
      ...(hours > 0 ? [`${hours} h`] : []),
      ...(remainingMinutes > 0 ? [`${remainingMinutes} min`] : []),
    ].join(" ");
  };
  const setShiftLength = (minutes) => {
    shiftLength.dataset.minutes = String(minutes);
    shiftLength.setAttribute("aria-label", `Shift time: ${formatShiftLength(minutes)}`);
    const arrow = document.createElement("span");
    arrow.className = "shift-length-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "▾";
    shiftLength.replaceChildren(
      document.createTextNode("Shift time"),
      arrow,
    );
    shiftLengthMenu.querySelectorAll('[role="option"]').forEach((option) => {
      option.setAttribute("aria-selected", String(option.dataset.minutes === String(minutes)));
    });
  };
  SHIFT_LENGTH_OPTIONS.forEach((minutes) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "shift-length-option";
    option.dataset.minutes = String(minutes);
    option.setAttribute("role", "option");
    option.textContent = formatShiftLength(minutes);
    option.addEventListener("click", () => {
      setShiftLength(minutes);
      shiftLength.setAttribute("aria-expanded", "false");
      updateDefaultEndTime(row);
      shiftLength.focus();
    });
    shiftLengthMenu.append(option);
  });
  setShiftLength(values.length ?? DEFAULT_SHIFT_LENGTH_MINUTES);
  shiftLength.addEventListener("click", () => {
    const isExpanded = shiftLength.getAttribute("aria-expanded") === "true";
    shiftLength.setAttribute("aria-expanded", String(!isExpanded));
  });
  shiftLength.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      shiftLength.setAttribute("aria-expanded", "true");
      const options = Array.from(shiftLengthMenu.querySelectorAll('[role="option"]'));
      const selectedIndex = options.findIndex(
        (option) => option.dataset.minutes === shiftLength.dataset.minutes,
      );
      const offset = event.key === "ArrowDown" ? 1 : -1;
      options[(selectedIndex + offset + options.length) % options.length].focus();
    } else if (event.key === "Escape") {
      shiftLength.setAttribute("aria-expanded", "false");
    }
  });
  shiftLengthMenu.addEventListener("keydown", (event) => {
    const options = Array.from(shiftLengthMenu.querySelectorAll('[role="option"]'));
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      options[(currentIndex + offset + options.length) % options.length].focus();
    } else if (event.key === "Escape") {
      shiftLength.setAttribute("aria-expanded", "false");
      shiftLength.focus();
    }
  });
  const closeShiftLengthMenu = (event) => {
    if (!shiftLengthControl.contains(event.target)) {
      shiftLength.setAttribute("aria-expanded", "false");
    }
  };
  document.addEventListener("click", closeShiftLengthMenu);
  shiftLengthControl.append(shiftLength, shiftLengthMenu);

  const actions = document.createElement("div");
  actions.className = "shift-actions";
  const scheduleButton = document.createElement("button");
  scheduleButton.type = "button";
  scheduleButton.className = "button button-secondary schedule-shift";
  scheduleButton.textContent = "Add to schedule";
  scheduleButton.addEventListener("click", () => scheduleShift(row, scheduleButton));
  actions.append(scheduleButton);

  const calendarControls = document.createElement("div");
  calendarControls.className = "calendar-controls";
  const calendarFooter = document.createElement("div");
  calendarFooter.className = "calendar-footer";
  calendarFooter.append(shiftLengthControl, resetDatesButton);
  calendarControls.append(dateCalendar, calendarFooter);
  dateCell.append(rowSummary);
  dateCell.append(calendarControls);
  startCell.append(startInput);
  endCell.append(endInput);
  actionCell.append(actions);
  row.append(dateCell, startCell, endCell, actionCell);
  shiftRows.append(row);
  updateToggleButton();
  renderCalendar(dateCalendar, row);
  updateShiftRowSummary(row);
  renderResults();
  if (shiftRows.rows.length > 1) {
    if (!rowsContainer.classList.contains("shift-list-has-history")) {
      rowsContainer.style.height = `${initialRowsContainerHeight}px`;
    }
    rowsContainer.classList.add("shift-list-has-history");
  }
  const tableHeader = row.closest("table").tHead;
  const headerHeight = tableHeader?.getBoundingClientRect().height ?? 0;
  const rowTop = row.getBoundingClientRect().top - rowsContainer.getBoundingClientRect().top;
  rowsContainer.scrollTop += rowTop - headerHeight;
}

function formatInputTime(minutes) {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hour =
    timeFormat === "24"
      ? String(hour24).padStart(2, "0")
      : String(hour24 % 12 || 12).padStart(2, "0");
  const time = `${hour}:${String(minute).padStart(2, "0")}`;
  return timeFormat === "24" ? time : `${time} ${hour24 < 12 ? "AM" : "PM"}`;
}

function updateShiftRowSummary(row) {
  const summary = row.querySelector(".shift-row-summary-text");
  if (!summary) return;

  const dates = getSelectedDates(row);
  const start = getTimeValue(row.querySelector('[data-role="start"]'));
  const end = getTimeValue(row.querySelector('[data-role="end"]'));
  const dateLabel = `${dates.length} ${dates.length === 1 ? "date" : "dates"}`;
  const timeLabel =
    start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end)
      ? `${formatInputTime(start)}–${formatInputTime(end)}`
      : "times not set";
  summary.textContent = `Shift ${row.dataset.shiftId} · ${dateLabel} · ${timeLabel}`;
}

function scheduleShift(row, button) {
  const selectedDates = getSelectedDates(row);
  const startMinutes = getTimeValue(row.querySelector('[data-role="start"]'));
  let endMinutes = getTimeValue(row.querySelector('[data-role="end"]'));

  if (selectedDates.length === 0) {
    statusMessage.textContent = "Select at least one office date before adding this shift.";
    return;
  }
  if (startMinutes === null || endMinutes === null) {
    statusMessage.textContent = "Enter both a start time and an end time before adding this shift.";
    return;
  }
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes === startMinutes) {
    statusMessage.textContent = "Enter valid start and end times that are not the same.";
    return;
  }
  if (endMinutes < startMinutes) endMinutes += 1440;

  const hasInvalidDate = selectedDates.some(
    (date) =>
      wallTimeToTimestamp(date, startMinutes, sourceTimezone) === null ||
      wallTimeToTimestamp(date, endMinutes, sourceTimezone) === null,
  );
  if (hasInvalidDate) {
    statusMessage.textContent =
      "This shift includes a time that is invalid because of a time-zone daylight-saving change.";
    return;
  }

  scheduledShifts.set(row.dataset.shiftId, {
    dates: selectedDates,
    startMinutes,
    endMinutes,
  });
  button.textContent = "Update schedule";
  statusMessage.textContent = "";
  renderResults();
}

function createTimeField(role, label, value) {
  const field = document.createElement("div");
  field.className = "time-input";
  field.dataset.role = role;
  field.setAttribute("aria-label", label);
  setTimeValue(field, value);
  return field;
}

function createTimeDropdown(label, placeholder, values, listId) {
  const wrapper = document.createElement("div");
  wrapper.className = "time-select-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.maxLength = 2;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-label", label);
  input.placeholder = placeholder;

  const options = document.createElement("div");
  options.id = listId;
  options.className = "time-options";
  options.setAttribute("role", "listbox");

  let activeOption = -1;
  let filterOptions = false;
  const closeOptions = () => {
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeOption = -1;
  };
  const renderOptions = () => {
    const query = filterOptions ? input.value : "";
    const matchingValues = values.filter((value) => !query || value.startsWith(query));
    options.replaceChildren();
    matchingValues.forEach((value) => {
      const option = document.createElement("div");
      option.id = `${listId}-${value}`;
      option.className = "time-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = value;
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        closeOptions();
      });
      options.append(option);
    });
    input.setAttribute("aria-expanded", String(matchingValues.length > 0));
    if (matchingValues.length === 0) input.removeAttribute("aria-activedescendant");
    activeOption = -1;
  };
  const showOptions = () => {
    filterOptions = false;
    renderOptions();
  };

  input.addEventListener("focus", showOptions);
  input.addEventListener("click", () => {
    if (input.getAttribute("aria-expanded") !== "true") showOptions();
  });
  input.addEventListener("blur", closeOptions);
  input.addEventListener("input", () => {
    filterOptions = true;
    renderOptions();
  });
  input.addEventListener("keydown", (event) => {
    const currentOptions = Array.from(options.children);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (currentOptions.length === 0) showOptions();
      const availableOptions = Array.from(options.children);
      if (availableOptions.length === 0) return;
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      activeOption =
        activeOption === -1
          ? direction === 1
            ? 0
            : availableOptions.length - 1
          : (activeOption + direction + availableOptions.length) % availableOptions.length;
      availableOptions.forEach((option, index) => {
        option.setAttribute("aria-selected", String(index === activeOption));
      });
      const active = availableOptions[activeOption];
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && activeOption >= 0) {
      event.preventDefault();
      currentOptions[activeOption]?.click();
    } else if (event.key === "Escape") {
      closeOptions();
    }
  });

  wrapper.append(input, options);
  return { wrapper, input };
}

function setTimeValue(field, value) {
  const separator = document.createElement("span");
  const fieldLabel = field.getAttribute("aria-label");
  const hour = createTimeDropdown(
    `${fieldLabel} hour`,
    "HH",
    Array.from({ length: timeFormat === "24" ? 24 : 12 }, (_, index) =>
      String(index + (timeFormat === "24" ? 0 : 1)).padStart(2, "0"),
    ),
    `time-hours-${++timeFieldId}`,
  );
  const hourInput = hour.input;
  separator.className = "time-separator";
  separator.textContent = ":";
  const minuteDropdown = createTimeDropdown(
    `${fieldLabel} minute`,
    "MM",
    Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")),
    `time-minutes-${++timeFieldId}`,
  );
  const minuteInput = minuteDropdown.input;

  const controls = [hourInput, minuteInput];
  let periodSelect;
  if (timeFormat === "12") {
    periodSelect = document.createElement("select");
    periodSelect.setAttribute("aria-label", `${field.getAttribute("aria-label")} AM or PM`);
    ["AM", "PM"].forEach((period) => {
      const option = document.createElement("option");
      option.value = period;
      option.textContent = period;
      periodSelect.append(option);
    });
    controls.push(periodSelect);
  }

  controls.forEach((control) => {
    const handleTimeChange = () => {
      updateShiftRowSummary(field.closest("tr"));
      if (field.dataset.role === "start") {
        updateDefaultEndTime(field.closest("tr"));
      }
      renderResults();
    };
    control.addEventListener("input", handleTimeChange);
    control.addEventListener("change", handleTimeChange);
  });
  field.replaceChildren(
    hour.wrapper,
    separator,
    minuteDropdown.wrapper,
    ...(periodSelect ? [periodSelect] : []),
  );

  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  const totalMinutes = parseTime(value);
  const hour24 = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  if (timeFormat === "24") {
    hourInput.value = String(hour24).padStart(2, "0");
  } else {
    hourInput.value = String(hour24 % 12 || 12).padStart(2, "0");
    periodSelect.value = hour24 < 12 ? "AM" : "PM";
  }
  minuteInput.value = String(minute).padStart(2, "0");
}

function getTimeValue(field) {
  const hourInput = field.querySelector('[aria-label$=" hour"]');
  const minuteInput = field.querySelector('[aria-label$=" minute"]');
  const periodSelect = field.querySelector("select");
  if (!hourInput.value || minuteInput.value === "") return null;

  const hour = Number(hourInput.value);
  const minute = Number(minuteInput.value);
  const maxHour = timeFormat === "24" ? 23 : 12;
  const minHour = timeFormat === "24" ? 0 : 1;
  if (
    !Number.isInteger(hour) ||
    hour < minHour ||
    hour > maxHour ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return Number.NaN;
  }

  if (timeFormat === "12") {
    if (!periodSelect) return Number.NaN;
    return ((hour % 12) + (periodSelect.value === "PM" ? 12 : 0)) * 60 + minute;
  }
  return hour * 60 + minute;
}

function updateDefaultEndTime(row) {
  const startField = row.querySelector('[data-role="start"]');
  const endField = row.querySelector('[data-role="end"]');
  const startMinutes = getTimeValue(startField);
  if (startMinutes === null || !Number.isFinite(startMinutes)) return;
  const shiftLength = Number(row.querySelector(".shift-length").dataset.minutes);
  setTimeValue(endField, (startMinutes + shiftLength) % (24 * 60));
  updateShiftRowSummary(row);
}

function updateTimeFormat(format) {
  if (format === timeFormat) return;
  const values = Array.from(shiftRows.rows, (row) => ({
    start: getTimeValue(row.querySelector('[data-role="start"]')),
    end: getTimeValue(row.querySelector('[data-role="end"]')),
  }));
  timeFormat = format;
  Array.from(shiftRows.rows).forEach((row, index) => {
    setTimeValue(row.querySelector('[data-role="start"]'), values[index].start);
    setTimeValue(row.querySelector('[data-role="end"]'), values[index].end);
    updateShiftRowSummary(row);
  });
  renderResults();
}

function getOfficeToday() {
  const parts = getZonedParts(Date.now(), sourceTimezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getSelectedDates(row) {
  return JSON.parse(row.dataset.selectedDates ?? "[]");
}

function renderCalendar(calendar, row) {
  const visibleMonth = new Date(`${row.dataset.visibleMonth}-01T00:00:00Z`);
  const monthStart = new Date(
    Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth(), 1),
  );
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - ((monthStart.getUTCDay() + 6) % 7));
  const selectedDates = new Set(getSelectedDates(row));
  const today = getOfficeToday();

  const header = document.createElement("div");
  header.className = "calendar-header";

  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "calendar-nav";
  previousButton.setAttribute("aria-label", "Previous month");
  previousButton.textContent = "‹";
  previousButton.addEventListener("click", () => {
    const previousMonth = new Date(
      Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() - 1, 1),
    );
    row.dataset.visibleMonth = toIsoDate(previousMonth).slice(0, 7);
    renderCalendar(calendar, row);
  });

  const title = document.createElement("strong");
  title.className = "calendar-title";
  title.textContent = monthFormatter.format(monthStart);

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "calendar-nav";
  nextButton.setAttribute("aria-label", "Next month");
  nextButton.textContent = "›";
  nextButton.addEventListener("click", () => {
    const nextMonth = new Date(
      Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() + 1, 1),
    );
    row.dataset.visibleMonth = toIsoDate(nextMonth).slice(0, 7);
    renderCalendar(calendar, row);
  });

  header.append(previousButton, title, nextButton);

  const weekdayRow = document.createElement("div");
  weekdayRow.className = "calendar-grid calendar-weekdays";
  WEEKDAYS.forEach((weekday) => {
    const label = document.createElement("span");
    label.textContent = weekday;
    weekdayRow.append(label);
  });

  const daysGrid = document.createElement("div");
  daysGrid.className = "calendar-grid calendar-days";

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const isoDate = toIsoDate(date);
    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = "calendar-day";
    dayButton.textContent = String(date.getUTCDate());
    dayButton.setAttribute("aria-label", dateFormatter.format(date));
    dayButton.setAttribute("aria-pressed", String(selectedDates.has(isoDate)));

    if (date.getUTCMonth() !== visibleMonth.getUTCMonth()) {
      dayButton.classList.add("outside-month");
    }
    if (isoDate === today) {
      dayButton.classList.add("today");
    }
    if (selectedDates.has(isoDate)) {
      dayButton.classList.add("selected");
    }

    dayButton.title = "Shift-click to select a date range";
    dayButton.addEventListener("click", (event) => {
      const selectionAnchor = row.dataset.dateSelectionAnchor;
      if (event.shiftKey && selectionAnchor) {
        const anchorTime = Date.parse(`${selectionAnchor}T00:00:00Z`);
        const targetTime = Date.parse(`${isoDate}T00:00:00Z`);
        const step = anchorTime <= targetTime ? 1 : -1;
        for (let timestamp = anchorTime; ; timestamp += step * 24 * 60 * 60 * 1000) {
          selectedDates.add(toIsoDate(new Date(timestamp)));
          if (timestamp === targetTime) break;
        }
      } else if (selectedDates.has(isoDate)) {
        selectedDates.delete(isoDate);
      } else {
        selectedDates.add(isoDate);
      }
      row.dataset.dateSelectionAnchor = isoDate;
      row.dataset.selectedDates = JSON.stringify(Array.from(selectedDates));

      if (date.getUTCMonth() !== visibleMonth.getUTCMonth()) {
        row.dataset.visibleMonth = isoDate.slice(0, 7);
      }
      renderCalendar(calendar, row);
      updateShiftRowSummary(row);
      renderResults();
    });

    daysGrid.append(dayButton);
  }

  calendar.replaceChildren(header, weekdayRow, daysGrid);
}

function parseTime(value) {
  if (typeof value === "number") return value;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function appendResultCell(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  row.append(cell);
}

function getIsoDateInZone(timestamp, timezone) {
  const parts = getZonedParts(timestamp, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function renderScheduleCalendar(scheduledRows) {
  const [year, month] = scheduleVisibleMonth.split("-").map(Number);
  const visibleMonth = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(visibleMonth);
  gridStart.setUTCDate(1 - ((visibleMonth.getUTCDay() + 6) % 7));
  const shiftsByDate = new Map();

  scheduledRows.forEach(({ startTimestamp, endTimestamp }) => {
    const date = getIsoDateInZone(startTimestamp, destinationTimezone);
    const endDate = getIsoDateInZone(endTimestamp, destinationTimezone);
    const entry = {
      startTimestamp,
      endTimestamp,
      overnight: date !== endDate,
    };
    if (!shiftsByDate.has(date)) shiftsByDate.set(date, []);
    shiftsByDate.get(date).push(entry);
  });

  const header = document.createElement("div");
  header.className = "schedule-calendar-header";
  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.className = "calendar-nav";
  previousButton.setAttribute("aria-label", "Previous month");
  previousButton.textContent = "‹";
  previousButton.addEventListener("click", () => {
    const previousMonth = new Date(Date.UTC(year, month - 2, 1));
    scheduleVisibleMonth = toIsoDate(previousMonth).slice(0, 7);
    renderScheduleCalendar(scheduledRows);
  });
  const title = document.createElement("strong");
  title.className = "calendar-title";
  title.textContent = monthFormatter.format(visibleMonth);
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "calendar-nav";
  nextButton.setAttribute("aria-label", "Next month");
  nextButton.textContent = "›";
  nextButton.addEventListener("click", () => {
    const nextMonth = new Date(Date.UTC(year, month, 1));
    scheduleVisibleMonth = toIsoDate(nextMonth).slice(0, 7);
    renderScheduleCalendar(scheduledRows);
  });
  header.append(previousButton, title, nextButton);

  const weekdayRow = document.createElement("div");
  weekdayRow.className = "schedule-calendar-grid schedule-calendar-weekdays";
  WEEKDAYS.forEach((weekday) => {
    const label = document.createElement("span");
    label.textContent = weekday;
    weekdayRow.append(label);
  });

  const daysGrid = document.createElement("div");
  daysGrid.className = "schedule-calendar-grid schedule-calendar-days";
  const today = getIsoDateInZone(Date.now(), destinationTimezone);
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const isoDate = toIsoDate(date);
    const dayCell = document.createElement("div");
    dayCell.className = "schedule-calendar-day";
    if (date.getUTCMonth() !== visibleMonth.getUTCMonth()) {
      dayCell.classList.add("outside-month");
    }
    if (isoDate === today) dayCell.classList.add("today");

    const dayNumber = document.createElement("span");
    dayNumber.className = "schedule-calendar-day-number";
    dayNumber.textContent = String(date.getUTCDate());
    dayCell.append(dayNumber);

    const dayShifts = shiftsByDate.get(isoDate) ?? [];
    dayShifts.forEach(({ startTimestamp, endTimestamp, overnight }) => {
      const shift = document.createElement("div");
      shift.className = "schedule-calendar-shift";
      const endTime = formatZoneTime(endTimestamp, destinationTimezone);
      shift.textContent = `${formatZoneTime(startTimestamp, destinationTimezone)}–${endTime}${overnight ? " (+1 day)" : ""}`;
      shift.setAttribute(
        "aria-label",
        `Shift from ${formatZoneTime(startTimestamp, destinationTimezone)} to ${formatZoneTime(endTimestamp, destinationTimezone)}${overnight ? ", next day" : ""}`,
      );
      dayCell.append(shift);
    });
    daysGrid.append(dayCell);
  }

  scheduleCalendar.replaceChildren(header, weekdayRow, daysGrid);
}

function removeScheduledOccurrence(shiftId, selectedDate) {
  const scheduledShift = scheduledShifts.get(shiftId);
  if (!scheduledShift) return;

  selectedScheduleEntries.delete(getScheduledEntryKey(shiftId, selectedDate));
  scheduledShift.dates = scheduledShift.dates.filter((date) => date !== selectedDate);
  if (scheduledShift.dates.length === 0) scheduledShifts.delete(shiftId);

  const inputRow = Array.from(shiftRows.rows).find((row) => row.dataset.shiftId === shiftId);
  if (inputRow) {
    const remainingDates = getSelectedDates(inputRow).filter((date) => date !== selectedDate);
    inputRow.dataset.selectedDates = JSON.stringify(remainingDates);
    renderCalendar(inputRow.querySelector(".date-calendar"), inputRow);
    if (scheduledShift.dates.length === 0) {
      inputRow.querySelector(".schedule-shift").textContent = "Add to schedule";
    }
  }

  renderResults();
}

function getScheduledEntryKey(shiftId, selectedDate) {
  return JSON.stringify([shiftId, selectedDate]);
}

function updateBulkDeleteControls(entryCount) {
  const selectedCount = selectedScheduleEntries.size;
  deleteSelectedShiftsButton.disabled = selectedCount === 0;
  deleteSelectedShiftsButton.hidden = scheduleView !== "table" || entryCount === 0;
}

function deleteSelectedScheduleEntries() {
  Array.from(selectedScheduleEntries, (key) => JSON.parse(key)).forEach(
    ([shiftId, selectedDate]) => removeScheduledOccurrence(shiftId, selectedDate),
  );
}

function renderResults() {
  resultRows.replaceChildren();
  const scheduledRows = [];
  let invalidCount = 0;
  const currentEntryKeys = new Set();
  let shiftGroupNumber = 0;

  scheduledShifts.forEach(({ dates, startMinutes, endMinutes }, shiftId) => {
    shiftGroupNumber += 1;
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      invalidCount += 1;
      return;
    }

    dates.forEach((selectedDate) => {
      const entryKey = getScheduledEntryKey(shiftId, selectedDate);
      currentEntryKeys.add(entryKey);
      const officeStartTimestamp = wallTimeToTimestamp(selectedDate, startMinutes, sourceTimezone);
      const officeEndTimestamp = wallTimeToTimestamp(selectedDate, endMinutes, sourceTimezone);
      if (officeStartTimestamp === null || officeEndTimestamp === null) {
        invalidCount += 1;
        return;
      }

      const resultRow = document.createElement("tr");
      resultRow.dataset.scheduleEntryKey = entryKey;
      resultRow.dataset.shiftId = shiftId;
      const selectionCell = document.createElement("td");
      selectionCell.className = "selection-column";
      const selectionCheckbox = document.createElement("input");
      selectionCheckbox.type = "checkbox";
      selectionCheckbox.className = "schedule-entry-select";
      selectionCheckbox.setAttribute(
        "aria-label",
        `Select shift on ${formatZoneDate(officeStartTimestamp, sourceTimezone)}`,
      );
      selectionCheckbox.checked = selectedScheduleEntries.has(entryKey);
      selectionCheckbox.addEventListener("change", () => {
        if (selectionCheckbox.checked) selectedScheduleEntries.add(entryKey);
        else selectedScheduleEntries.delete(entryKey);
        const groupRow = Array.from(resultRows.querySelectorAll(".schedule-group-row")).find(
          (candidate) => candidate.dataset.shiftId === shiftId,
        );
        if (groupRow) {
          const groupCheckbox = groupRow.querySelector(".schedule-group-select");
          const groupKeys = scheduledRows
            .filter((entry) => entry.shiftId === shiftId)
            .map((entry) => getScheduledEntryKey(shiftId, entry.selectedDate));
          const selectedCount = groupKeys.filter((key) => selectedScheduleEntries.has(key)).length;
          groupCheckbox.checked = selectedCount === groupKeys.length;
          groupCheckbox.indeterminate = selectedCount > 0 && selectedCount < groupKeys.length;
        }
        updateBulkDeleteControls(scheduledRows.length);
      });
      selectionCell.append(selectionCheckbox);
      resultRow.append(selectionCell);
      appendResultCell(resultRow, formatZoneDate(officeStartTimestamp, sourceTimezone));
      appendResultCell(
        resultRow,
        `${formatZoneDate(officeStartTimestamp, destinationTimezone)}, ${formatZoneTime(officeStartTimestamp, destinationTimezone)}`,
      );
      appendResultCell(
        resultRow,
        `${formatZoneDate(officeEndTimestamp, destinationTimezone)}, ${formatZoneTime(officeEndTimestamp, destinationTimezone)}`,
      );
      scheduledRows.push({
        shiftId,
        shiftGroupNumber,
        selectedDate,
        startTimestamp: officeStartTimestamp,
        endTimestamp: officeEndTimestamp,
        row: resultRow,
      });
    });
  });

  selectedScheduleEntries.forEach((key) => {
    if (!currentEntryKeys.has(key)) selectedScheduleEntries.delete(key);
  });
  let displayedShiftId;
  scheduledRows.forEach(({ shiftId, shiftGroupNumber, row }) => {
    if (shiftId !== displayedShiftId) {
      const groupRow = document.createElement("tr");
      groupRow.className = "schedule-group-row";
      groupRow.dataset.shiftId = shiftId;
      const groupCell = document.createElement("th");
      groupCell.scope = "rowgroup";
      groupCell.colSpan = 4;
      const groupLabel = document.createElement("span");
      groupLabel.textContent = `Shift ${shiftGroupNumber} · dates in selected order`;
      const groupCheckbox = document.createElement("input");
      groupCheckbox.type = "checkbox";
      groupCheckbox.className = "schedule-group-select";
      groupCheckbox.setAttribute("aria-label", `Select all dates in shift ${shiftGroupNumber}`);
      const groupKeys = scheduledRows
        .filter((entry) => entry.shiftId === shiftId)
        .map((entry) => getScheduledEntryKey(shiftId, entry.selectedDate));
      const selectedCount = groupKeys.filter((key) => selectedScheduleEntries.has(key)).length;
      groupCheckbox.checked = groupKeys.length > 0 && selectedCount === groupKeys.length;
      groupCheckbox.indeterminate = selectedCount > 0 && selectedCount < groupKeys.length;
      groupCheckbox.addEventListener("change", () => {
        groupKeys.forEach((key) => {
          if (groupCheckbox.checked) selectedScheduleEntries.add(key);
          else selectedScheduleEntries.delete(key);
        });
        resultRows.querySelectorAll(".schedule-entry-select").forEach((checkbox) => {
          if (checkbox.closest("tr").dataset.shiftId === shiftId) {
            checkbox.checked = groupCheckbox.checked;
          }
        });
        updateBulkDeleteControls(scheduledRows.length);
      });
      groupCell.append(groupCheckbox, groupLabel);
      groupRow.append(groupCell);
      resultRows.append(groupRow);
      displayedShiftId = shiftId;
    }
    resultRows.append(row);
  });
  const convertedCount = scheduledRows.length;
  resultTable.hidden = scheduleView !== "table" || convertedCount === 0;
  scheduleCalendar.hidden = scheduleView !== "calendar" || convertedCount === 0;
  tableViewButton.setAttribute("aria-pressed", String(scheduleView === "table"));
  calendarViewButton.setAttribute("aria-pressed", String(scheduleView === "calendar"));
  renderScheduleCalendar(scheduledRows);
  updateBulkDeleteControls(convertedCount);

  const messages = [];
  if (convertedCount === 0 && scheduledShifts.size === 0 && invalidCount === 0) {
    messages.push("Add a shift to your schedule to see it converted.");
  }
  if (invalidCount > 0) {
    messages.push(
      `${invalidCount} shift ${invalidCount === 1 ? "has" : "have"} invalid or matching times. Check the times and time-zone daylight-saving rules.`,
    );
  }
  statusMessage.textContent = messages.join(" ");
}

deleteSelectedShiftsButton.addEventListener("click", deleteSelectedScheduleEntries);

tableViewButton.addEventListener("click", () => {
  scheduleView = "table";
  renderResults();
});
calendarViewButton.addEventListener("click", () => {
  scheduleView = "calendar";
  renderResults();
});
document.querySelector("#add-shift").addEventListener("click", createShiftRow);
document.querySelectorAll('input[name="time-format"]').forEach((radio) => {
  radio.addEventListener("change", () => updateTimeFormat(radio.value));
});

const helpMenu = document.querySelector(".help-menu");
const helpMenuToggle = document.querySelector("#help-menu-toggle");
const helpMenuContent = document.querySelector("#help-menu-content");

function closeHelpMenu() {
  helpMenuContent.hidden = true;
  helpMenuToggle.setAttribute("aria-expanded", "false");
  helpMenuToggle.setAttribute("aria-label", "Open timetable help");
}

helpMenuToggle.addEventListener("click", () => {
  const isExpanded = helpMenuToggle.getAttribute("aria-expanded") === "true";
  helpMenuContent.hidden = isExpanded;
  helpMenuToggle.setAttribute("aria-expanded", String(!isExpanded));
  helpMenuToggle.setAttribute(
    "aria-label",
    isExpanded ? "Open timetable help" : "Close timetable help",
  );
});
document.addEventListener("click", (event) => {
  if (!helpMenu.contains(event.target)) closeHelpMenu();
});
helpMenuToggle.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeHelpMenu();
});
createShiftRow();
