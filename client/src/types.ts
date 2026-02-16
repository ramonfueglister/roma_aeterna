export type CityMarker = {
  id: string;
  name: string;
  tileX: number;
  tileY: number;
  culture: string;
  size: 'metropolis' | 'large' | 'medium' | 'small' | 'village';
  provinceNumber: number;
  color: number;
};
