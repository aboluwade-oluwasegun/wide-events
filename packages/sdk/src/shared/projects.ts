export interface ProjectRoutingConfigOption {
  ids?: readonly string[] | undefined;
  refreshIntervalMs: number;
}

export type ProjectRoutingOption = false | ProjectRoutingConfigOption;
