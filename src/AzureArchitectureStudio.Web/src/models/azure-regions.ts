// Azure regions catalog. Used to populate region/location dropdowns for
// resource groups and per-resource location overrides.
//
// Source: `az account list-locations --output table` for a typical commercial
// tenant (April 2025). National clouds (Gov / China / Germany) are not
// included — add them if you need them.

export interface AzureRegion {
  /** ARM short name, e.g. "eastus". This is what goes into the ARM template. */
  name: string;
  /** Friendly name shown in the dropdown, e.g. "East US". */
  displayName: string;
  /** Geography group used to organise the dropdown, e.g. "United States". */
  geography: string;
  /** True when the region is paired (commodity, GA). False for special-purpose. */
  paired?: boolean;
}

export const AZURE_REGIONS: readonly AzureRegion[] = [
  // ---------------- North America ----------------
  { name: 'eastus', displayName: 'East US', geography: 'United States', paired: true },
  { name: 'eastus2', displayName: 'East US 2', geography: 'United States', paired: true },
  { name: 'centralus', displayName: 'Central US', geography: 'United States', paired: true },
  { name: 'northcentralus', displayName: 'North Central US', geography: 'United States', paired: true },
  { name: 'southcentralus', displayName: 'South Central US', geography: 'United States', paired: true },
  { name: 'westcentralus', displayName: 'West Central US', geography: 'United States', paired: true },
  { name: 'westus', displayName: 'West US', geography: 'United States', paired: true },
  { name: 'westus2', displayName: 'West US 2', geography: 'United States', paired: true },
  { name: 'westus3', displayName: 'West US 3', geography: 'United States', paired: true },
  { name: 'eastusstg', displayName: 'East US STG', geography: 'United States' },
  { name: 'mexicocentral', displayName: 'Mexico Central', geography: 'Mexico', paired: true },
  { name: 'canadacentral', displayName: 'Canada Central', geography: 'Canada', paired: true },
  { name: 'canadaeast', displayName: 'Canada East', geography: 'Canada', paired: true },

  // ---------------- South America ----------------
  { name: 'brazilsouth', displayName: 'Brazil South', geography: 'Brazil', paired: true },
  { name: 'brazilsoutheast', displayName: 'Brazil Southeast', geography: 'Brazil' },
  { name: 'brazilus', displayName: 'Brazil US', geography: 'Brazil' },

  // ---------------- Europe ----------------
  { name: 'northeurope', displayName: 'North Europe', geography: 'Europe', paired: true },
  { name: 'westeurope', displayName: 'West Europe', geography: 'Europe', paired: true },
  { name: 'francecentral', displayName: 'France Central', geography: 'France', paired: true },
  { name: 'francesouth', displayName: 'France South', geography: 'France', paired: true },
  { name: 'germanywestcentral', displayName: 'Germany West Central', geography: 'Germany', paired: true },
  { name: 'germanynorth', displayName: 'Germany North', geography: 'Germany', paired: true },
  { name: 'italynorth', displayName: 'Italy North', geography: 'Italy' },
  { name: 'norwayeast', displayName: 'Norway East', geography: 'Norway', paired: true },
  { name: 'norwaywest', displayName: 'Norway West', geography: 'Norway', paired: true },
  { name: 'polandcentral', displayName: 'Poland Central', geography: 'Poland' },
  { name: 'spaincentral', displayName: 'Spain Central', geography: 'Spain' },
  { name: 'switzerlandnorth', displayName: 'Switzerland North', geography: 'Switzerland', paired: true },
  { name: 'switzerlandwest', displayName: 'Switzerland West', geography: 'Switzerland', paired: true },
  { name: 'swedencentral', displayName: 'Sweden Central', geography: 'Sweden', paired: true },
  { name: 'swedensouth', displayName: 'Sweden South', geography: 'Sweden' },
  { name: 'uksouth', displayName: 'UK South', geography: 'United Kingdom', paired: true },
  { name: 'ukwest', displayName: 'UK West', geography: 'United Kingdom', paired: true },

  // ---------------- Middle East ----------------
  { name: 'israelcentral', displayName: 'Israel Central', geography: 'Israel' },
  { name: 'qatarcentral', displayName: 'Qatar Central', geography: 'Qatar' },
  { name: 'uaenorth', displayName: 'UAE North', geography: 'UAE', paired: true },
  { name: 'uaecentral', displayName: 'UAE Central', geography: 'UAE', paired: true },

  // ---------------- Africa ----------------
  { name: 'southafricanorth', displayName: 'South Africa North', geography: 'South Africa', paired: true },
  { name: 'southafricawest', displayName: 'South Africa West', geography: 'South Africa', paired: true },

  // ---------------- Asia Pacific ----------------
  { name: 'australiaeast', displayName: 'Australia East', geography: 'Australia', paired: true },
  { name: 'australiasoutheast', displayName: 'Australia Southeast', geography: 'Australia', paired: true },
  { name: 'australiacentral', displayName: 'Australia Central', geography: 'Australia' },
  { name: 'australiacentral2', displayName: 'Australia Central 2', geography: 'Australia' },
  { name: 'centralindia', displayName: 'Central India', geography: 'India', paired: true },
  { name: 'southindia', displayName: 'South India', geography: 'India', paired: true },
  { name: 'westindia', displayName: 'West India', geography: 'India' },
  { name: 'jioindiawest', displayName: 'Jio India West', geography: 'India' },
  { name: 'jioindiacentral', displayName: 'Jio India Central', geography: 'India' },
  { name: 'japaneast', displayName: 'Japan East', geography: 'Japan', paired: true },
  { name: 'japanwest', displayName: 'Japan West', geography: 'Japan', paired: true },
  { name: 'koreacentral', displayName: 'Korea Central', geography: 'Korea', paired: true },
  { name: 'koreasouth', displayName: 'Korea South', geography: 'Korea', paired: true },
  { name: 'eastasia', displayName: 'East Asia', geography: 'Asia Pacific', paired: true },
  { name: 'southeastasia', displayName: 'Southeast Asia', geography: 'Asia Pacific', paired: true },
  { name: 'taiwannorth', displayName: 'Taiwan North', geography: 'Taiwan' },
  { name: 'taiwannorthwest', displayName: 'Taiwan Northwest', geography: 'Taiwan' },
  { name: 'newzealandnorth', displayName: 'New Zealand North', geography: 'New Zealand' },
  { name: 'indonesiacentral', displayName: 'Indonesia Central', geography: 'Indonesia' },
  { name: 'malaysiawest', displayName: 'Malaysia West', geography: 'Malaysia' },
];

/** O(1) lookup map keyed by ARM short name. */
const REGION_BY_NAME: Record<string, AzureRegion> = AZURE_REGIONS.reduce(
  (acc, r) => {
    acc[r.name] = r;
    return acc;
  },
  {} as Record<string, AzureRegion>,
);

export function getRegion(name: string): AzureRegion | undefined {
  return REGION_BY_NAME[name];
}

/**
 * Convert the regions list into the {label,value}[] shape used by
 * PropertyField select options. Sorted by geography then display name so
 * the dropdown groups naturally.
 */
export function regionOptions(): { label: string; value: string }[] {
  const sorted = [...AZURE_REGIONS].sort((a, b) => {
    const g = a.geography.localeCompare(b.geography);
    if (g !== 0) return g;
    return a.displayName.localeCompare(b.displayName);
  });
  return sorted.map((r) => ({
    label: `${r.displayName} (${r.name})`,
    value: r.name,
  }));
}
