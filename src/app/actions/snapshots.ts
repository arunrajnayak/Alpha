'use server';

import { prisma } from '@/lib/db';
import { DailyPortfolioSnapshot, WeeklyPortfolioSnapshot, MonthlyPortfolioSnapshot } from '@prisma/client';

export async function getDailySnapshots(): Promise<DailyPortfolioSnapshot[]> {
  try {
    const snapshots = await prisma.dailyPortfolioSnapshot.findMany({
      orderBy: {
        date: 'desc',
      },
    });
    return snapshots;
  } catch (error) {
    console.error('Failed to fetch daily snapshots:', error);
    return [];
  }
}

export async function getWeeklySnapshots(): Promise<WeeklyPortfolioSnapshot[]> {
  try {
    const snapshots = await prisma.weeklyPortfolioSnapshot.findMany({
      orderBy: {
        date: 'desc',
      },
    });
    return snapshots;
  } catch (error) {
    console.error('Failed to fetch weekly snapshots:', error);
    return [];
  }
}

export async function getMonthlySnapshots(): Promise<MonthlyPortfolioSnapshot[]> {
  try {
    const snapshots = await prisma.monthlyPortfolioSnapshot.findMany({
      orderBy: {
        date: 'desc',
      },
    });
    return snapshots;
  } catch (error) {
    console.error('Failed to fetch monthly snapshots:', error);
    return [];
  }
}
