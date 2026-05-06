// Curated catalog of Azure Virtual Machine sizes, organised by family.
// Used to populate the cascading VM Family → VM Size dropdowns in the
// resource property panel.
//
// This is a hand-maintained subset of the public Azure VM sizes. Azure also
// exposes a live list per region via:
//   GET https://management.azure.com/subscriptions/{sub}
//       /providers/Microsoft.Compute/locations/{location}
//       /vmSizes?api-version=2024-07-01
// Switching to the live API would require the user to be signed in AND to
// have selected a subscription + region for each VM. The static catalog
// below is the design-time fallback and works offline.
//
// Naming: `key` matches the value used in resource-types.json under the
// `vmFamily` field (and in the `visibleWhen` clauses for vmSize).

export interface VmSize {
  /** ARM size name, e.g. "Standard_D4s_v5" — what gets written to the template. */
  name: string;
  /** Logical core count (sometimes physical cores; matches Azure docs). */
  vCpu: number;
  /** RAM in gibibytes. */
  memGib: number;
  /** Optional extra info shown in the dropdown (e.g. "1× T4 GPU", "1.92 TB NVMe"). */
  extra?: string;
}

export interface VmFamily {
  /** Unique key used in resource-types.json `vmFamily.value`. */
  key: string;
  /** Short human-readable family name, e.g. "Dsv5". */
  shortName: string;
  /** One-line description shown in the family dropdown. */
  description: string;
  /** Default vmSize when this family is first selected. */
  defaultSize: string;
  /** Sizes within the family, ordered small → large. */
  sizes: VmSize[];
}

export const VM_FAMILIES: readonly VmFamily[] = [
  // --------------------------------------------------------------------
  // Burstable — dev/test, low average CPU
  // --------------------------------------------------------------------
  {
    key: 'B',
    shortName: 'B-series',
    description: 'Burstable (dev/test, low avg CPU)',
    defaultSize: 'Standard_B2s',
    sizes: [
      { name: 'Standard_B1ls', vCpu: 1, memGib: 0.5 },
      { name: 'Standard_B1s', vCpu: 1, memGib: 1 },
      { name: 'Standard_B1ms', vCpu: 1, memGib: 2 },
      { name: 'Standard_B2s', vCpu: 2, memGib: 4 },
      { name: 'Standard_B2ms', vCpu: 2, memGib: 8 },
      { name: 'Standard_B4ms', vCpu: 4, memGib: 16 },
      { name: 'Standard_B8ms', vCpu: 8, memGib: 32 },
      { name: 'Standard_B12ms', vCpu: 12, memGib: 48 },
      { name: 'Standard_B16ms', vCpu: 16, memGib: 64 },
      { name: 'Standard_B20ms', vCpu: 20, memGib: 80 },
    ],
  },

  // --------------------------------------------------------------------
  // General purpose
  // --------------------------------------------------------------------
  {
    key: 'Dsv5',
    shortName: 'Dsv5',
    description: 'General purpose (Intel, current gen)',
    defaultSize: 'Standard_D2s_v5',
    sizes: [
      { name: 'Standard_D2s_v5', vCpu: 2, memGib: 8 },
      { name: 'Standard_D4s_v5', vCpu: 4, memGib: 16 },
      { name: 'Standard_D8s_v5', vCpu: 8, memGib: 32 },
      { name: 'Standard_D16s_v5', vCpu: 16, memGib: 64 },
      { name: 'Standard_D32s_v5', vCpu: 32, memGib: 128 },
      { name: 'Standard_D48s_v5', vCpu: 48, memGib: 192 },
      { name: 'Standard_D64s_v5', vCpu: 64, memGib: 256 },
      { name: 'Standard_D96s_v5', vCpu: 96, memGib: 384 },
    ],
  },
  {
    key: 'Ddsv5',
    shortName: 'Ddsv5',
    description: 'General purpose (Intel, with local SSD)',
    defaultSize: 'Standard_D2ds_v5',
    sizes: [
      { name: 'Standard_D2ds_v5', vCpu: 2, memGib: 8, extra: '75 GB local SSD' },
      { name: 'Standard_D4ds_v5', vCpu: 4, memGib: 16, extra: '150 GB local SSD' },
      { name: 'Standard_D8ds_v5', vCpu: 8, memGib: 32, extra: '300 GB local SSD' },
      { name: 'Standard_D16ds_v5', vCpu: 16, memGib: 64, extra: '600 GB local SSD' },
      { name: 'Standard_D32ds_v5', vCpu: 32, memGib: 128, extra: '1.2 TB local SSD' },
      { name: 'Standard_D48ds_v5', vCpu: 48, memGib: 192, extra: '1.8 TB local SSD' },
      { name: 'Standard_D64ds_v5', vCpu: 64, memGib: 256, extra: '2.4 TB local SSD' },
      { name: 'Standard_D96ds_v5', vCpu: 96, memGib: 384, extra: '3.6 TB local SSD' },
    ],
  },
  {
    key: 'Dasv5',
    shortName: 'Dasv5',
    description: 'General purpose (AMD EPYC, current gen)',
    defaultSize: 'Standard_D2as_v5',
    sizes: [
      { name: 'Standard_D2as_v5', vCpu: 2, memGib: 8 },
      { name: 'Standard_D4as_v5', vCpu: 4, memGib: 16 },
      { name: 'Standard_D8as_v5', vCpu: 8, memGib: 32 },
      { name: 'Standard_D16as_v5', vCpu: 16, memGib: 64 },
      { name: 'Standard_D32as_v5', vCpu: 32, memGib: 128 },
      { name: 'Standard_D48as_v5', vCpu: 48, memGib: 192 },
      { name: 'Standard_D64as_v5', vCpu: 64, memGib: 256 },
      { name: 'Standard_D96as_v5', vCpu: 96, memGib: 384 },
    ],
  },
  {
    key: 'Dpsv5',
    shortName: 'Dpsv5',
    description: 'General purpose (Ampere ARM64, energy efficient)',
    defaultSize: 'Standard_D2ps_v5',
    sizes: [
      { name: 'Standard_D2ps_v5', vCpu: 2, memGib: 8 },
      { name: 'Standard_D4ps_v5', vCpu: 4, memGib: 16 },
      { name: 'Standard_D8ps_v5', vCpu: 8, memGib: 32 },
      { name: 'Standard_D16ps_v5', vCpu: 16, memGib: 64 },
      { name: 'Standard_D32ps_v5', vCpu: 32, memGib: 128 },
      { name: 'Standard_D48ps_v5', vCpu: 48, memGib: 192 },
      { name: 'Standard_D64ps_v5', vCpu: 64, memGib: 208 },
    ],
  },
  {
    key: 'Dsv4',
    shortName: 'Dsv4',
    description: 'General purpose (Intel, prev gen)',
    defaultSize: 'Standard_D2s_v4',
    sizes: [
      { name: 'Standard_D2s_v4', vCpu: 2, memGib: 8 },
      { name: 'Standard_D4s_v4', vCpu: 4, memGib: 16 },
      { name: 'Standard_D8s_v4', vCpu: 8, memGib: 32 },
      { name: 'Standard_D16s_v4', vCpu: 16, memGib: 64 },
      { name: 'Standard_D32s_v4', vCpu: 32, memGib: 128 },
      { name: 'Standard_D48s_v4', vCpu: 48, memGib: 192 },
      { name: 'Standard_D64s_v4', vCpu: 64, memGib: 256 },
    ],
  },
  {
    key: 'Dsv3',
    shortName: 'Dsv3',
    description: 'General purpose (Intel, legacy v3)',
    defaultSize: 'Standard_D2s_v3',
    sizes: [
      { name: 'Standard_D2s_v3', vCpu: 2, memGib: 8 },
      { name: 'Standard_D4s_v3', vCpu: 4, memGib: 16 },
      { name: 'Standard_D8s_v3', vCpu: 8, memGib: 32 },
      { name: 'Standard_D16s_v3', vCpu: 16, memGib: 64 },
      { name: 'Standard_D32s_v3', vCpu: 32, memGib: 128 },
      { name: 'Standard_D48s_v3', vCpu: 48, memGib: 192 },
      { name: 'Standard_D64s_v3', vCpu: 64, memGib: 256 },
    ],
  },

  // --------------------------------------------------------------------
  // Memory optimised
  // --------------------------------------------------------------------
  {
    key: 'Esv5',
    shortName: 'Esv5',
    description: 'Memory optimised (Intel, 8 GiB/vCPU)',
    defaultSize: 'Standard_E2s_v5',
    sizes: [
      { name: 'Standard_E2s_v5', vCpu: 2, memGib: 16 },
      { name: 'Standard_E4s_v5', vCpu: 4, memGib: 32 },
      { name: 'Standard_E8s_v5', vCpu: 8, memGib: 64 },
      { name: 'Standard_E16s_v5', vCpu: 16, memGib: 128 },
      { name: 'Standard_E20s_v5', vCpu: 20, memGib: 160 },
      { name: 'Standard_E32s_v5', vCpu: 32, memGib: 256 },
      { name: 'Standard_E48s_v5', vCpu: 48, memGib: 384 },
      { name: 'Standard_E64s_v5', vCpu: 64, memGib: 512 },
      { name: 'Standard_E96s_v5', vCpu: 96, memGib: 672 },
      { name: 'Standard_E104is_v5', vCpu: 104, memGib: 672, extra: 'isolated' },
    ],
  },
  {
    key: 'Easv5',
    shortName: 'Easv5',
    description: 'Memory optimised (AMD EPYC)',
    defaultSize: 'Standard_E2as_v5',
    sizes: [
      { name: 'Standard_E2as_v5', vCpu: 2, memGib: 16 },
      { name: 'Standard_E4as_v5', vCpu: 4, memGib: 32 },
      { name: 'Standard_E8as_v5', vCpu: 8, memGib: 64 },
      { name: 'Standard_E16as_v5', vCpu: 16, memGib: 128 },
      { name: 'Standard_E20as_v5', vCpu: 20, memGib: 160 },
      { name: 'Standard_E32as_v5', vCpu: 32, memGib: 256 },
      { name: 'Standard_E48as_v5', vCpu: 48, memGib: 384 },
      { name: 'Standard_E64as_v5', vCpu: 64, memGib: 512 },
      { name: 'Standard_E96as_v5', vCpu: 96, memGib: 672 },
    ],
  },
  {
    key: 'Epsv5',
    shortName: 'Epsv5',
    description: 'Memory optimised (Ampere ARM64)',
    defaultSize: 'Standard_E2ps_v5',
    sizes: [
      { name: 'Standard_E2ps_v5', vCpu: 2, memGib: 16 },
      { name: 'Standard_E4ps_v5', vCpu: 4, memGib: 32 },
      { name: 'Standard_E8ps_v5', vCpu: 8, memGib: 64 },
      { name: 'Standard_E16ps_v5', vCpu: 16, memGib: 128 },
      { name: 'Standard_E32ps_v5', vCpu: 32, memGib: 208 },
    ],
  },

  // --------------------------------------------------------------------
  // Compute optimised
  // --------------------------------------------------------------------
  {
    key: 'Fsv2',
    shortName: 'Fsv2',
    description: 'Compute optimised (high CPU/RAM ratio)',
    defaultSize: 'Standard_F2s_v2',
    sizes: [
      { name: 'Standard_F2s_v2', vCpu: 2, memGib: 4 },
      { name: 'Standard_F4s_v2', vCpu: 4, memGib: 8 },
      { name: 'Standard_F8s_v2', vCpu: 8, memGib: 16 },
      { name: 'Standard_F16s_v2', vCpu: 16, memGib: 32 },
      { name: 'Standard_F32s_v2', vCpu: 32, memGib: 64 },
      { name: 'Standard_F48s_v2', vCpu: 48, memGib: 96 },
      { name: 'Standard_F64s_v2', vCpu: 64, memGib: 128 },
      { name: 'Standard_F72s_v2', vCpu: 72, memGib: 144 },
    ],
  },
  {
    key: 'Falsv6',
    shortName: 'Falsv6',
    description: 'Compute optimised (AMD EPYC, no local disk)',
    defaultSize: 'Standard_F2als_v6',
    sizes: [
      { name: 'Standard_F2als_v6', vCpu: 2, memGib: 4 },
      { name: 'Standard_F4als_v6', vCpu: 4, memGib: 8 },
      { name: 'Standard_F8als_v6', vCpu: 8, memGib: 16 },
      { name: 'Standard_F16als_v6', vCpu: 16, memGib: 32 },
      { name: 'Standard_F32als_v6', vCpu: 32, memGib: 64 },
      { name: 'Standard_F48als_v6', vCpu: 48, memGib: 96 },
      { name: 'Standard_F64als_v6', vCpu: 64, memGib: 128 },
    ],
  },

  // --------------------------------------------------------------------
  // Storage optimised
  // --------------------------------------------------------------------
  {
    key: 'Lsv3',
    shortName: 'Lsv3',
    description: 'Storage optimised (Intel, NVMe)',
    defaultSize: 'Standard_L8s_v3',
    sizes: [
      { name: 'Standard_L8s_v3', vCpu: 8, memGib: 64, extra: '1.92 TB NVMe' },
      { name: 'Standard_L16s_v3', vCpu: 16, memGib: 128, extra: '3.84 TB NVMe' },
      { name: 'Standard_L32s_v3', vCpu: 32, memGib: 256, extra: '7.68 TB NVMe' },
      { name: 'Standard_L48s_v3', vCpu: 48, memGib: 384, extra: '11.52 TB NVMe' },
      { name: 'Standard_L64s_v3', vCpu: 64, memGib: 512, extra: '15.36 TB NVMe' },
      { name: 'Standard_L80s_v3', vCpu: 80, memGib: 640, extra: '19.2 TB NVMe' },
    ],
  },
  {
    key: 'Lasv3',
    shortName: 'Lasv3',
    description: 'Storage optimised (AMD EPYC, NVMe)',
    defaultSize: 'Standard_L8as_v3',
    sizes: [
      { name: 'Standard_L8as_v3', vCpu: 8, memGib: 64, extra: '1.92 TB NVMe' },
      { name: 'Standard_L16as_v3', vCpu: 16, memGib: 128, extra: '3.84 TB NVMe' },
      { name: 'Standard_L32as_v3', vCpu: 32, memGib: 256, extra: '7.68 TB NVMe' },
      { name: 'Standard_L48as_v3', vCpu: 48, memGib: 384, extra: '11.52 TB NVMe' },
      { name: 'Standard_L64as_v3', vCpu: 64, memGib: 512, extra: '15.36 TB NVMe' },
      { name: 'Standard_L80as_v3', vCpu: 80, memGib: 640, extra: '19.2 TB NVMe' },
    ],
  },

  // --------------------------------------------------------------------
  // Big-memory (SAP HANA, in-memory DBs)
  // --------------------------------------------------------------------
  {
    key: 'Msv2',
    shortName: 'Msv2',
    description: 'Memory optimised (SAP HANA, big RAM)',
    defaultSize: 'Standard_M8ms',
    sizes: [
      { name: 'Standard_M8ms', vCpu: 8, memGib: 218 },
      { name: 'Standard_M16ms', vCpu: 16, memGib: 437 },
      { name: 'Standard_M32ts', vCpu: 32, memGib: 192 },
      { name: 'Standard_M32ms', vCpu: 32, memGib: 875 },
      { name: 'Standard_M64s', vCpu: 64, memGib: 1024 },
      { name: 'Standard_M64ms', vCpu: 64, memGib: 1792 },
      { name: 'Standard_M128s', vCpu: 128, memGib: 2048 },
      { name: 'Standard_M128ms', vCpu: 128, memGib: 3892 },
      { name: 'Standard_M192ims', vCpu: 192, memGib: 4096 },
    ],
  },
  {
    key: 'Mv3',
    shortName: 'Mv3',
    description: 'Memory optimised v3 (massive RAM, latest)',
    defaultSize: 'Standard_M32dms_v3',
    sizes: [
      { name: 'Standard_M32dms_v3', vCpu: 32, memGib: 875 },
      { name: 'Standard_M64dms_v3', vCpu: 64, memGib: 1792 },
      { name: 'Standard_M128dms_v3', vCpu: 128, memGib: 3892 },
      { name: 'Standard_M176ds_v3', vCpu: 176, memGib: 2794 },
      { name: 'Standard_M176ds_3_v3', vCpu: 176, memGib: 4096 },
      { name: 'Standard_M624ds_12_v3', vCpu: 624, memGib: 12 * 1024 },
    ],
  },

  // --------------------------------------------------------------------
  // HPC
  // --------------------------------------------------------------------
  {
    key: 'HBv3',
    shortName: 'HBv3',
    description: 'HPC (AMD EPYC 7003, Milan-X)',
    defaultSize: 'Standard_HB120rs_v3',
    sizes: [
      { name: 'Standard_HB120rs_v3', vCpu: 120, memGib: 448, extra: 'InfiniBand HDR' },
      { name: 'Standard_HB120-96rs_v3', vCpu: 96, memGib: 448, extra: 'InfiniBand HDR' },
      { name: 'Standard_HB120-64rs_v3', vCpu: 64, memGib: 448, extra: 'InfiniBand HDR' },
      { name: 'Standard_HB120-32rs_v3', vCpu: 32, memGib: 448, extra: 'InfiniBand HDR' },
      { name: 'Standard_HB120-16rs_v3', vCpu: 16, memGib: 448, extra: 'InfiniBand HDR' },
    ],
  },
  {
    key: 'HBv4',
    shortName: 'HBv4',
    description: 'HPC (AMD EPYC 9004, Genoa-X)',
    defaultSize: 'Standard_HB176rs_v4',
    sizes: [
      { name: 'Standard_HB176rs_v4', vCpu: 176, memGib: 768, extra: 'InfiniBand NDR' },
      { name: 'Standard_HB176-144rs_v4', vCpu: 144, memGib: 768, extra: 'InfiniBand NDR' },
      { name: 'Standard_HB176-96rs_v4', vCpu: 96, memGib: 768, extra: 'InfiniBand NDR' },
      { name: 'Standard_HB176-48rs_v4', vCpu: 48, memGib: 768, extra: 'InfiniBand NDR' },
      { name: 'Standard_HB176-24rs_v4', vCpu: 24, memGib: 768, extra: 'InfiniBand NDR' },
    ],
  },
  {
    key: 'HX',
    shortName: 'HX',
    description: 'HPC (AMD EPYC, large memory)',
    defaultSize: 'Standard_HX176rs',
    sizes: [
      { name: 'Standard_HX176rs', vCpu: 176, memGib: 1408, extra: 'InfiniBand NDR' },
      { name: 'Standard_HX176-144rs', vCpu: 144, memGib: 1408, extra: 'InfiniBand NDR' },
      { name: 'Standard_HX176-96rs', vCpu: 96, memGib: 1408, extra: 'InfiniBand NDR' },
    ],
  },

  // --------------------------------------------------------------------
  // GPU — inference
  // --------------------------------------------------------------------
  {
    key: 'NCasT4v3',
    shortName: 'NCasT4_v3',
    description: 'GPU — inference (Nvidia T4)',
    defaultSize: 'Standard_NC4as_T4_v3',
    sizes: [
      { name: 'Standard_NC4as_T4_v3', vCpu: 4, memGib: 28, extra: '1× T4 16 GB' },
      { name: 'Standard_NC8as_T4_v3', vCpu: 8, memGib: 56, extra: '1× T4 16 GB' },
      { name: 'Standard_NC16as_T4_v3', vCpu: 16, memGib: 110, extra: '1× T4 16 GB' },
      { name: 'Standard_NC64as_T4_v3', vCpu: 64, memGib: 440, extra: '4× T4 16 GB' },
    ],
  },
  {
    key: 'NVadsA10v5',
    shortName: 'NVadsA10_v5',
    description: 'GPU — visualisation / VDI (Nvidia A10)',
    defaultSize: 'Standard_NV6ads_A10_v5',
    sizes: [
      { name: 'Standard_NV6ads_A10_v5', vCpu: 6, memGib: 55, extra: '1/6× A10 24 GB' },
      { name: 'Standard_NV12ads_A10_v5', vCpu: 12, memGib: 110, extra: '1/3× A10 24 GB' },
      { name: 'Standard_NV18ads_A10_v5', vCpu: 18, memGib: 220, extra: '1/2× A10 24 GB' },
      { name: 'Standard_NV36ads_A10_v5', vCpu: 36, memGib: 440, extra: '1× A10 24 GB' },
      { name: 'Standard_NV36adms_A10_v5', vCpu: 36, memGib: 880, extra: '1× A10 24 GB' },
      { name: 'Standard_NV72ads_A10_v5', vCpu: 72, memGib: 880, extra: '2× A10 24 GB' },
    ],
  },

  // --------------------------------------------------------------------
  // GPU — training
  // --------------------------------------------------------------------
  {
    key: 'NCv3',
    shortName: 'NCv3',
    description: 'GPU — training (Nvidia V100)',
    defaultSize: 'Standard_NC6s_v3',
    sizes: [
      { name: 'Standard_NC6s_v3', vCpu: 6, memGib: 112, extra: '1× V100 16 GB' },
      { name: 'Standard_NC12s_v3', vCpu: 12, memGib: 224, extra: '2× V100 16 GB' },
      { name: 'Standard_NC24s_v3', vCpu: 24, memGib: 448, extra: '4× V100 16 GB' },
      { name: 'Standard_NC24rs_v3', vCpu: 24, memGib: 448, extra: '4× V100 16 GB + RDMA' },
    ],
  },
  {
    key: 'NCadsA100v4',
    shortName: 'NCadsA100_v4',
    description: 'GPU — training (Nvidia A100 80 GB)',
    defaultSize: 'Standard_NC24ads_A100_v4',
    sizes: [
      { name: 'Standard_NC24ads_A100_v4', vCpu: 24, memGib: 220, extra: '1× A100 80 GB' },
      { name: 'Standard_NC48ads_A100_v4', vCpu: 48, memGib: 440, extra: '2× A100 80 GB' },
      { name: 'Standard_NC96ads_A100_v4', vCpu: 96, memGib: 880, extra: '4× A100 80 GB' },
    ],
  },
  {
    key: 'NDmA100v4',
    shortName: 'NDm A100 v4',
    description: 'GPU — large-scale training (8× A100 80 GB + InfiniBand)',
    defaultSize: 'Standard_ND96amsr_A100_v4',
    sizes: [
      { name: 'Standard_ND96amsr_A100_v4', vCpu: 96, memGib: 1900, extra: '8× A100 80 GB, NDR IB' },
    ],
  },
  {
    key: 'NDH100v5',
    shortName: 'ND H100 v5',
    description: 'GPU — frontier training (8× H100 80 GB + InfiniBand)',
    defaultSize: 'Standard_ND96isr_H100_v5',
    sizes: [
      { name: 'Standard_ND96isr_H100_v5', vCpu: 96, memGib: 1900, extra: '8× H100 80 GB, NDR IB' },
    ],
  },
];

const FAMILY_BY_KEY: Record<string, VmFamily> = VM_FAMILIES.reduce(
  (acc, f) => {
    acc[f.key] = f;
    return acc;
  },
  {} as Record<string, VmFamily>,
);

export function getVmFamily(key: string): VmFamily | undefined {
  return FAMILY_BY_KEY[key];
}

/** Family dropdown options, ordered as declared in VM_FAMILIES. */
export function vmFamilyOptions(): { label: string; value: string }[] {
  return VM_FAMILIES.map((f) => ({
    label: `${f.shortName} — ${f.description}`,
    value: f.key,
  }));
}

/** Per-family size dropdown options. Returns empty list if family unknown. */
export function vmSizeOptions(familyKey: string): { label: string; value: string }[] {
  const fam = FAMILY_BY_KEY[familyKey];
  if (!fam) return [];
  return fam.sizes.map((s) => ({
    label: formatSizeLabel(s),
    value: s.name,
  }));
}

function formatSizeLabel(s: VmSize): string {
  // e.g. "D4s v5 (4 vCPU, 16 GiB) — 1× T4 16 GB"
  const stripped = s.name.replace(/^Standard_/, '').replace(/_/g, ' ');
  const base = `${stripped} (${s.vCpu} vCPU, ${s.memGib} GiB)`;
  return s.extra ? `${base} — ${s.extra}` : base;
}

// ---------------------------------------------------------------------------
// Live API integration
// ---------------------------------------------------------------------------
//
// Azure VM size names follow a fairly stable grammar:
//
//   Standard_<series-letter(s)><cpu-count><features>[_<accelerator>]_<version>
//
// Examples:
//   Standard_B2s                      -> series=B,   features="",     version=v1
//   Standard_D4s_v5                   -> series=D,   features=s,      version=v5
//   Standard_D4ds_v5                  -> series=D,   features=ds,     version=v5
//   Standard_D4as_v5                  -> series=D,   features=as,     version=v5
//   Standard_D4ps_v5                  -> series=D,   features=ps,     version=v5
//   Standard_E32-16as_v5              -> series=E,   features=as,     version=v5  (constrained)
//   Standard_F2als_v6                 -> series=F,   features=als,    version=v6
//   Standard_M128ms                   -> series=M,   features=ms,     version=v1
//   Standard_NC24ads_A100_v4          -> series=NC,  features=ads,    accel=A100, version=v4
//   Standard_NV12ads_A10_v5           -> series=NV,  features=ads,    accel=A10,  version=v5
//   Standard_HB120rs_v3               -> series=HB,  features=rs,     version=v3
//
// We capture: leading letters (series), the trailing _vN (version), and an
// optional _<ACCEL> token between (e.g. _A100, _T4, _H100). All other
// numeric/feature noise is collapsed so a whole family ends up under the
// same key. The family key matches the catalog keys above where possible
// so the curated descriptions/orderings still apply.

const SIZE_PARSER =
  /^standard_([A-Za-z]+)\d+(?:-\d+)?([a-z]*)(?:_([A-Za-z][A-Za-z0-9]*))?(?:_v(\d+))?$/i;

interface ParsedSize {
  series: string;        // e.g. "D", "NC", "HB"
  features: string;      // lowercase suffix letters, e.g. "as", "ds", "ms"
  accelerator?: string;  // upper-case token, e.g. "A100", "T4"
  version: number;       // 1 if no _vN suffix
}

/** Parse an Azure VM size name into its structural pieces. */
export function parseVmSizeName(name: string): ParsedSize | null {
  const m = SIZE_PARSER.exec(name);
  if (!m) return null;
  const [, series, features, accel, version] = m;
  return {
    series: series.toUpperCase(),
    features: (features ?? '').toLowerCase(),
    accelerator: accel?.toUpperCase(),
    version: version ? parseInt(version, 10) : 1,
  };
}

/**
 * Compute a family key for a given size. The key tries to match the
 * curated catalog (e.g. "Dsv5", "NCadsA100v4", "B") so live API results
 * naturally collapse onto the same family bucket as our hand-curated
 * entries. Returns "Other" when the name doesn't parse.
 */
export function familyKeyForSize(name: string): string {
  const p = parseVmSizeName(name);
  if (!p) return 'Other';
  // Burstable sits on its own — treat _all_ B-series as one family
  // regardless of feature suffix.
  if (p.series === 'B') return 'B';
  // Constrain known accelerator strings into the canonical key form
  // ("ads" + accel + "v" + version) so e.g. NC24ads_A100_v4 and
  // NC48ads_A100_v4 both land in NCadsA100v4.
  if (p.accelerator) {
    return `${p.series}${p.features}${p.accelerator}v${p.version}`;
  }
  return `${p.series}${p.features}v${p.version}`;
}

/** Derive a friendly description for a family computed via parsing. */
function describeDerivedFamily(key: string, sample: ParsedSize): string {
  const parts: string[] = [];
  switch (sample.series) {
    case 'A': parts.push('General purpose (legacy)'); break;
    case 'B': parts.push('Burstable'); break;
    case 'D': parts.push('General purpose'); break;
    case 'E': parts.push('Memory optimised'); break;
    case 'F': parts.push('Compute optimised'); break;
    case 'L': parts.push('Storage optimised'); break;
    case 'M': parts.push('Memory optimised (large)'); break;
    case 'H':
    case 'HB':
    case 'HC':
    case 'HX': parts.push('HPC'); break;
    case 'N':
    case 'NC':
    case 'ND':
    case 'NG':
    case 'NV': parts.push('GPU'); break;
    default:  parts.push(`Series ${sample.series}`);
  }
  if (sample.features.includes('a')) parts.push('AMD');
  else if (sample.features.includes('p')) parts.push('ARM Ampere');
  if (sample.features.includes('d')) parts.push('local disk');
  if (sample.features.includes('s')) parts.push('premium storage');
  if (sample.accelerator) parts.push(sample.accelerator);
  parts.push(`v${sample.version}`);
  return `${key} — ${parts.join(', ')}`;
}

interface LiveSizeInput {
  name: string;
  numberOfCores: number;
  memoryInMB: number;
}

/**
 * Convert a live ARM vmSizes response into the same VmFamily[] shape used
 * by the static catalog. Falls back to the curated description when the
 * key matches a known family. Sizes are sorted by vCPU then memory.
 */
export function buildFamiliesFromLiveSizes(live: LiveSizeInput[]): VmFamily[] {
  const buckets = new Map<string, { sizes: VmSize[]; sample: ParsedSize }>();
  for (const s of live) {
    const key = familyKeyForSize(s.name);
    const parsed = parseVmSizeName(s.name);
    if (!parsed) continue; // ignore "Basic_*" or anything unrecognised
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { sizes: [], sample: parsed };
      buckets.set(key, bucket);
    }
    bucket.sizes.push({
      name: s.name,
      vCpu: s.numberOfCores,
      memGib: Math.round((s.memoryInMB / 1024) * 10) / 10,
    });
  }

  const families: VmFamily[] = [];
  for (const [key, { sizes, sample }] of buckets) {
    sizes.sort((a, b) => a.vCpu - b.vCpu || a.memGib - b.memGib);
    const curated = FAMILY_BY_KEY[key];
    families.push({
      key,
      shortName: curated?.shortName ?? key,
      description: curated?.description ?? describeDerivedFamily(key, sample).replace(/^.*? — /, ''),
      defaultSize: curated?.defaultSize ?? sizes[0]?.name ?? '',
      sizes,
    });
  }

  // Order: curated families first (in catalog order), then derived ones
  // alphabetically. Keeps the UX stable while still surfacing brand-new
  // families that haven't been added to the catalog yet.
  const curatedOrder = new Map(VM_FAMILIES.map((f, i) => [f.key, i] as const));
  families.sort((a, b) => {
    const ai = curatedOrder.get(a.key) ?? Number.POSITIVE_INFINITY;
    const bi = curatedOrder.get(b.key) ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.shortName.localeCompare(b.shortName);
  });
  return families;
}

/** Same formatter as the static catalog uses, exported for the picker. */
export function formatSizeLabelPublic(s: VmSize): string {
  return formatSizeLabel(s);
}
