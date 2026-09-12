export interface LogisticsFact {
  shipmentId: string;
  projectId: string;
  poLineId: string;
  activityId: string;
  eta: string;
  receivedAt?: string;
  siteReady: boolean;
  quantityExpected: number;
  quantityReceived: number;
}

export interface AssetFact {
  assetId: string;
  projectId: string;
  activityId: string;
  status: 'available' | 'reserved' | 'unavailable' | 'expired';
  availableFrom?: string;
  expiresAt?: string;
}

export interface ReadinessContext {
  asOf?: string;
  activityNeedDates?: Readonly<Record<string, string>>;
}

export interface ReadinessImpact { ready: boolean; reasons: readonly string[]; }

function parse(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function assessLogisticsAndAssetReadiness(
  logistics: readonly LogisticsFact[],
  assets: readonly AssetFact[],
  context: ReadinessContext = {},
): ReadinessImpact {
  const reasons: string[] = [];
  const asOf = parse(context.asOf) ?? Date.now();

  for (const l of logistics) {
    if (!l.siteReady) reasons.push(`Site not ready for shipment ${l.shipmentId}.`);
    if (l.quantityExpected < 0 || l.quantityReceived < 0) {
      reasons.push(`Shipment ${l.shipmentId} has invalid quantity data.`);
      continue;
    }
    if (l.quantityReceived < l.quantityExpected) reasons.push(`Shipment ${l.shipmentId} is short ${l.quantityExpected - l.quantityReceived} unit(s).`);

    const needDateRaw = context.activityNeedDates?.[l.activityId];
    const needAt = parse(needDateRaw);
    const eta = parse(l.eta);
    const receivedAt = parse(l.receivedAt);
    if (needDateRaw && needAt === undefined) reasons.push(`Activity ${l.activityId} has an invalid need date.`);
    if (eta === undefined) reasons.push(`Shipment ${l.shipmentId} has an invalid ETA.`);
    if (needAt !== undefined) {
      if (receivedAt !== undefined && receivedAt > needAt) reasons.push(`Shipment ${l.shipmentId} was received after activity ${l.activityId} needed it.`);
      else if (receivedAt === undefined && eta !== undefined && eta > needAt) reasons.push(`Shipment ${l.shipmentId} ETA is after activity ${l.activityId} need date.`);
    }
  }

  for (const a of assets) {
    const usableStatus = a.status === 'available' || a.status === 'reserved';
    if (!usableStatus) reasons.push(`Asset ${a.assetId} is ${a.status}.`);

    const needDateRaw = context.activityNeedDates?.[a.activityId];
    const needAt = parse(needDateRaw) ?? asOf;
    if (needDateRaw && parse(needDateRaw) === undefined) reasons.push(`Activity ${a.activityId} has an invalid need date.`);

    const availableFrom = parse(a.availableFrom);
    const expiresAt = parse(a.expiresAt);
    if (a.availableFrom && availableFrom === undefined) reasons.push(`Asset ${a.assetId} has an invalid availableFrom date.`);
    if (a.expiresAt && expiresAt === undefined) reasons.push(`Asset ${a.assetId} has an invalid expiresAt date.`);
    if (availableFrom !== undefined && availableFrom > needAt) reasons.push(`Asset ${a.assetId} is not available by activity ${a.activityId} need date.`);
    if (expiresAt !== undefined && expiresAt <= needAt) reasons.push(`Asset ${a.assetId} expires before it is needed for activity ${a.activityId}.`);
  }

  return { ready: reasons.length === 0, reasons };
}
