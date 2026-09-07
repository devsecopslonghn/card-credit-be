import type { MasterBankDto, MasterCardTypeDto } from "@card-credit/contracts";
import { MASTERDATA_DEFAULT_LIMIT, MASTERDATA_MAX_LIMIT, type MasterdataRepository, type MasterRecord } from "../masterdata.js";
import type { ServiceContext } from "./types/service-context.js";

const stringValue = (value: unknown) => typeof value === "string" ? value : "";
const idValue = (value: unknown) => String(value ?? "").trim();
const boundedLimit = (value: unknown) => Math.min(Math.max(Number.parseInt(typeof value === "string" ? value : String(MASTERDATA_DEFAULT_LIMIT), 10) || MASTERDATA_DEFAULT_LIMIT, 1), MASTERDATA_MAX_LIMIT);

const bankDto = (record: MasterRecord): MasterBankDto => ({
  _id: idValue(record._id),
  shortname: stringValue(record.shortname),
  name: stringValue(record.name),
  fullname: stringValue(record.fullname),
  logo: stringValue(record.logo),
});

const cardTypeDto = (record: MasterRecord): MasterCardTypeDto => ({
  _id: idValue(record._id),
  name: stringValue(record.name),
  logo: stringValue(record.logo),
});

export class MasterdataQueryService {
  static async listBanks(_ctx: ServiceContext, repository: MasterdataRepository, rawLimit: unknown): Promise<MasterBankDto[]> {
    const records = await repository.list("banks", "shortname", boundedLimit(rawLimit));
    return records.map(bankDto);
  }

  static async listCardTypes(_ctx: ServiceContext, repository: MasterdataRepository, rawLimit: unknown): Promise<MasterCardTypeDto[]> {
    const records = await repository.list("cardtypes", "name", boundedLimit(rawLimit));
    return records.map(cardTypeDto);
  }
}
