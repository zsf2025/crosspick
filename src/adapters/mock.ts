import type { ProductCandidate } from '@/types/product'

export function mockProducts(): ProductCandidate[] {
  return [
    {
      id: 'p1',
      name: 'LED Desk Lamp with Wireless Charger',
      category: 'Home & Office',
      cost: 8.5,
      weightKg: 0.6,
      keywords: ['desk lamp', 'wireless charging', 'usb lamp'],
      competitors: [
        { asin: 'B0X1', title: 'Desk Lamp A', price: 25.99, rating: 4.3, reviewCount: 12400, monthlySales: 3200 },
        { asin: 'B0X2', title: 'Desk Lamp B', price: 32.99, rating: 4.6, reviewCount: 8100, monthlySales: 1800 },
        { asin: 'B0X3', title: 'Desk Lamp C', price: 19.99, rating: 4.0, reviewCount: 22000, monthlySales: 5100 },
      ],
      reviewInsights: [
        { painPoint: '充电底座发热严重', mentionCount: 342, sentiment: 'negative' },
        { painPoint: '亮度档位不够', mentionCount: 128, sentiment: 'negative' },
        { painPoint: '外观很有质感', mentionCount: 890, sentiment: 'positive' },
      ],
    },
    {
      id: 'p2',
      name: 'Silicone Air Fryer Liners (6pcs)',
      category: 'Kitchen',
      cost: 1.2,
      weightKg: 0.15,
      keywords: ['air fryer accessories', 'silicone liner'],
      competitors: [
        { asin: 'B0Y1', title: 'Liner Set A', price: 12.99, rating: 4.5, reviewCount: 45000, monthlySales: 12000 },
        { asin: 'B0Y2', title: 'Liner Set B', price: 9.99, rating: 4.2, reviewCount: 31000, monthlySales: 9800 },
      ],
      reviewInsights: [
        { painPoint: '尺寸偏小，8qt放不下', mentionCount: 560, sentiment: 'negative' },
        { painPoint: '容易吸附食物残渣难清洗', mentionCount: 210, sentiment: 'negative' },
      ],
    },
    {
      id: 'p3',
      name: 'Resistance Bands Set with Handles',
      category: 'Sports',
      cost: 3.8,
      weightKg: 0.4,
      keywords: ['resistance bands', 'home gym'],
      competitors: [
        { asin: 'B0Z1', title: 'Bands A', price: 21.99, rating: 4.4, reviewCount: 67000, monthlySales: 8500 },
        { asin: 'B0Z2', title: 'Bands B', price: 15.99, rating: 4.1, reviewCount: 41000, monthlySales: 6200 },
        { asin: 'B0Z3', title: 'Bands C', price: 28.99, rating: 4.7, reviewCount: 12000, monthlySales: 2100 },
        { asin: 'B0Z4', title: 'Bands D', price: 18.99, rating: 4.3, reviewCount: 29000, monthlySales: 4400 },
      ],
      reviewInsights: [
        { painPoint: '手柄容易断裂', mentionCount: 430, sentiment: 'negative' },
        { painPoint: ' latex气味大', mentionCount: 190, sentiment: 'negative' },
        { painPoint: '性价比很高', mentionCount: 1200, sentiment: 'positive' },
      ],
    },
  ]
}