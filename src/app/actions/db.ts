'use server';

import { prisma } from '@/lib/db';

export async function getDatabaseModels() {
  // Hardcoded list of models we want to expose
  // In a real scenario, we might want to introspect, but for now this is safer
  return [
    'Transaction',
    'ImportBatch',
    'StockHistory',
    'IndexHistory',
    'DailyPortfolioSnapshot',
    'WeeklyPortfolioSnapshot',
    'MonthlyPortfolioSnapshot',
    'MarketCapDefinition',
    'SymbolMapping',
    'Job',
    'AppConfig',
  ].sort();
}

export async function getDatabaseData(model: string, page: number = 1, pageSize: number = 50, search: string = '') {
  try {
    const skip = (page - 1) * pageSize;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[model];

    if (!delegate) {
      throw new Error(`Model ${model} not found`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};
    if (search) {
      // Basic search logic depending on model fields
      if (model === 'Transaction') {
        where['OR'] = [
            { symbol: { contains: search } },
            { description: { contains: search } },
            { orderId: { contains: search } },
        ];
      } else if (['StockHistory', 'IndexHistory'].includes(model)) {
         where['symbol'] = { contains: search };
      } else if (model === 'ImportBatch') {
         where['filename'] = { contains: search };
      } else if (model === 'SymbolMapping') {
         where['OR'] = [
             { oldSymbol: { contains: search } },
             { newSymbol: { contains: search } },
         ];
      } else if (model === 'AppConfig') {
         where['OR'] = [
             { key: { contains: search } },
             { value: { contains: search } },
         ];
      } else if (model === 'Job') {
          where['OR'] = [
              { id: { contains: search } },
              { type: { contains: search } },
          ];
      }
      // Snapshots usually don't have text fields to search easily, maybe date? date is strict equal usually.
    }

    const [data, total] = await Promise.all([
      delegate.findMany({
        skip,
        take: pageSize,
        where,
        orderBy: {
           // still relying on default order or no order
        },
      }),
      delegate.count({ where }),
    ]);

    // Serialize dates and complex objects
    const serializedData = JSON.parse(JSON.stringify(data));

    return {
      data: serializedData,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    console.error(`Error fetching data for ${model}:`, error);
    throw new Error('Failed to fetch data');
  }
}
