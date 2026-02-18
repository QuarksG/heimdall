import { RegionConfig, RegionConfigFactory } from './base/RegionConfig.interface';
import { TurkeyConfig } from './implementations/tr.config';

class RegionRegistry implements RegionConfigFactory {
  private configs: Map<string, RegionConfig> = new Map();
  
  constructor() {
    this.registerConfig(TurkeyConfig);
  }
  
  private registerConfig(config: RegionConfig): void {
    this.configs.set(config.regionCode.toUpperCase(), config);
  }
  
  public getConfig(regionCode: string): RegionConfig {
    const normalizedCode = regionCode.toUpperCase();
    const config = this.configs.get(normalizedCode);
    
    if (!config) {
      throw new Error(`Region configuration not found for: ${regionCode}`);
    }
    
    return config;
  }
  
  public getSupportedRegions(): string[] {
    return Array.from(this.configs.keys());
  }
  
  public hasRegion(regionCode: string): boolean {
    return this.configs.has(regionCode.toUpperCase());
  }
}

export const regionRegistry = new RegionRegistry();
export { RegionConfig } from './base/RegionConfig.interface';