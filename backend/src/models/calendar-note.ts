import mongoose, { Schema } from "mongoose";

const CalendarNoteSchema = new Schema({
  workspaceId: { type: String, required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  content: { type: String, required: true, maxlength: 5000 },
}, { timestamps: true, collection: "calendarnotes" });
CalendarNoteSchema.index({ workspaceId: 1, date: 1 }, { unique: true });
CalendarNoteSchema.index({ workspaceId: 1, date: -1 });

export const CalendarNoteModel = (mongoose.models.CalendarNote ?? mongoose.model("CalendarNote", CalendarNoteSchema)) as mongoose.Model<Record<string, unknown>>;
