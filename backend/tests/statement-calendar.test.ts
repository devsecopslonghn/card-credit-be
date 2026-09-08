import assert from "node:assert/strict";
import test from "node:test";
import { composeStatementCalendarEmail } from "../src/statement-calendar-email.js";
import { projectStatementCalendar, serializeStatementCalendar } from "../src/statement-calendar.js";
import { effectivePaymentStatus, isOverdue, isPaid, isUnpaid } from "../src/statement-domain.js";

const input = {
  identity: "workspace/card/statement",
  displayName: "Thẻ Việt, Platinum; Plus",
  providerName: "Ngân hàng Việt",
  owner: "Tôi",
  periodStartDate: "2028-02-01",
  periodEndDate: "2028-02-29",
  statementDate: "2028-02-29",
  paymentDueDate: "2028-12-31",
  totalAmountDue: 1_250_000,
  effectivePaymentStatus: "OVERDUE",
};

test("projection creates one deterministic payment-due event without raw identity", () => {
  const events = projectStatementCalendar(input);
  assert.equal(events.length, 1);
  assert.deepEqual(events.map((event) => event.type), ["payment-due"]);
  assert.deepEqual(events.map((event) => event.date), ["2028-12-31"]);
  assert.match(events[0]!.title, /^Hạn thanh toán/);
  assert.deepEqual(projectStatementCalendar(input), events);
  assert.equal(events.some((event) => event.description.includes(input.identity)), false);
  assert.match(events[0]!.description, /Quá hạn/);
});

test("serializer emits a three-day payment window with three display alarms", () => {
  const calendar = serializeStatementCalendar(projectStatementCalendar(input), new Date("2026-07-11T12:34:56.000Z"));
  assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
  assert.match(calendar, /CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH/);
  assert.equal(calendar.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.match(calendar, /DTSTAMP:20260711T123456Z/);
  assert.match(calendar, /DTSTART;TZID=Asia\/Ho_Chi_Minh:20281228T000000\r\nDTEND;TZID=Asia\/Ho_Chi_Minh:20281231T170000/);
  assert.equal(calendar.match(/BEGIN:VALARM/g)?.length, 3);
  assert.match(calendar, /TRIGGER;RELATED=START:PT0S/);
  assert.match(calendar, /TRIGGER;RELATED=END:-PT8H/);
  assert.match(calendar, /TRIGGER;RELATED=END:-PT2H/);
  assert.match(calendar, /SUMMARY:Hạn thanh toán – Thẻ Việt\\, Platinum\\; Plus/);
  assert.match(calendar, /\r\n /);
  assert.equal(calendar.replaceAll("\r\n", "").includes("\n"), false);
  assert.equal(calendar.includes(input.identity), false);
});

test("serializer handles non-leap month boundaries and all text escape classes", () => {
  const events = projectStatementCalendar({ ...input, paymentDueDate: "2027-02-28", displayName: "Thẻ \\ A, B; C\nD" });
  const calendar = serializeStatementCalendar(events, new Date("2026-01-01T00:00:00Z"));
  assert.match(calendar, /DTSTART;TZID=Asia\/Ho_Chi_Minh:20270225T000000\r\nDTEND;TZID=Asia\/Ho_Chi_Minh:20270228T170000/);
  assert.match(calendar, /Thẻ \\\\ A\\, B\\; C\\nD/);
});

test("effective status preserves paid/open and derives overdue without changing due-today", () => {
  assert.equal(effectivePaymentStatus({ paymentStatus: "PAID", paymentDueDate: "2026-01-01" }, "2026-07-11"), "PAID");
  assert.equal(effectivePaymentStatus({ paymentStatus: "OPEN", paymentDueDate: "2026-07-12" }, "2026-07-11"), "OPEN");
  assert.equal(effectivePaymentStatus({ paymentStatus: "OPEN", paymentDueDate: "2026-07-11" }, "2026-07-11"), "OPEN");
  assert.equal(effectivePaymentStatus({ paymentStatus: "STATEMENT_CLOSED", paymentDueDate: "2026-07-10" }, "2026-07-11"), "OVERDUE");
  assert.equal(isPaid({ paymentStatus: "PAID" }), true);
  assert.equal(isUnpaid({ paymentStatus: "STATEMENT_CLOSED" }), true);
  assert.equal(isOverdue({ paymentStatus: "STATEMENT_CLOSED", paymentDueDate: "2026-07-10" }, "2026-07-11"), true);
  assert.equal(isOverdue({ paymentStatus: "STATEMENT_CLOSED", paymentDueDate: "2026-07-11" }, "2026-07-11"), false);
});

test("email composer creates safe Vietnamese multipart content and calendar filename", () => {
  const email = composeStatementCalendarEmail({ ...input, displayName: "../Thẻ\r\nBcc: bad@example.test", recipient: "owner@example.test", calendarContent: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" });
  assert.equal(email.to, "owner@example.test");
  assert.match(email.subject, /^Lịch hạn thanh toán/);
  assert.equal(email.subject.includes("\r"), false);
  assert.match(email.text, /nhập một lần/);
  assert.match(email.text, /không phải đồng bộ liên tục/);
  assert.match(email.text, /1\.250\.000 VND/);
  assert.match(email.attachment.filename, /^lich-han-thanh-toan-[a-z0-9-]+-2028-12\.ics$/);
  assert.equal(email.attachment.filename.includes(".."), false);
  assert.equal(email.attachment.filename.includes("owner@"), false);
  assert.equal(email.attachment.contentType, "text/calendar; charset=utf-8; method=PUBLISH");
});
