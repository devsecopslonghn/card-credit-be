import mongoose from "mongoose";

export type DatabaseState = "disconnected" | "connecting" | "connected" | "failed";

export class DatabaseLifecycle {
  state: DatabaseState = "disconnected";

  async connect(uri: string) {
    this.state = "connecting";
    try {
      await mongoose.connect(uri);
      this.state = "connected";
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }

  async disconnect() {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    this.state = "disconnected";
  }

  isReady() {
    return this.state === "connected";
  }
}
