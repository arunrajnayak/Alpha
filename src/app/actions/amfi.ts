'use server';

import { parseAMFIExcel, syncAMFIClassifications, AMFIPeriod, getCurrentAMFIPeriod } from '@/lib/amfi-service';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';

/**
 * Get AMFI upload history from database
 */
export async function getAMFIHistory(): Promise<Array<{ period: string; count: number; updatedAt: string }>> {
    try {
        // Get distinct periods with counts and max updatedAt in a single query
        const periods = await prisma.aMFIClassification.groupBy({
            by: ['period'],
            _count: { symbol: true },
            _max: { updatedAt: true },
            orderBy: { period: 'desc' },
        });

        const history = periods.map((p) => ({
            period: p.period,
            count: p._count.symbol,
            updatedAt: p._max.updatedAt?.toISOString() || new Date().toISOString(),
        }));

        return history;
    } catch (error) {
        console.error('[AMFI History] Error:', error);
        return [];
    }
}

/**
 * Check if AMFI data needs to be updated for the current period
 */
export async function checkAMFIStatus(): Promise<{
    needsUpdate: boolean;
    currentPeriod: string;
    appliedPeriod: string;
    message: string;
}> {
    try {
        const now = new Date();
        const currentPeriod = getCurrentAMFIPeriod(now);
        const periodStr = `${currentPeriod.year}_${currentPeriod.halfYear}`;
        
        // Calculate which period's data we need (rolling logic)
        // Jan-Jun needs previous year's H2, Jul-Dec needs current year's H1
        const month = now.getMonth();
        let neededYear: number;
        let neededHalf: 'H1' | 'H2';
        
        if (month < 6) {
            // Jan-Jun: need previous year's H2
            neededYear = now.getFullYear() - 1;
            neededHalf = 'H2';
        } else {
            // Jul-Dec: need current year's H1
            neededYear = now.getFullYear();
            neededHalf = 'H1';
        }
        
        const neededPeriodStr = `${neededYear}_${neededHalf}`;
        
        // Check if we have data for the needed period
        const count = await prisma.aMFIClassification.count({
            where: { period: neededPeriodStr },
        });
        
        if (count === 0) {
            return {
                needsUpdate: true,
                currentPeriod: periodStr,
                appliedPeriod: neededPeriodStr,
                message: `Missing ${neededYear} ${neededHalf} classification data. Please upload to ensure accurate market cap categorization.`,
            };
        }
        
        return {
            needsUpdate: false,
            currentPeriod: periodStr,
            appliedPeriod: neededPeriodStr,
            message: `Using ${neededYear} ${neededHalf} data (${count} stocks)`,
        };
    } catch (error) {
        console.error('[AMFI Status] Error:', error);
        return {
            needsUpdate: true,
            currentPeriod: 'unknown',
            appliedPeriod: 'unknown',
            message: 'Unable to check AMFI status',
        };
    }
}

export async function uploadAMFIAction(formData: FormData) {
    try {
        const file = formData.get('file') as File;
        const year = parseInt(formData.get('year') as string);
        const halfYear = formData.get('halfYear') as 'H1' | 'H2';

        if (!file || !year || !halfYear) {
            return { success: false, error: 'Missing required fields' };
        }

        const buffer = await file.arrayBuffer();
        const classifications = await parseAMFIExcel(buffer);

        if (classifications.length === 0) {
            return { success: false, error: 'No data found in Excel file. Please check the file format.' };
        }

        const period: AMFIPeriod = { year, halfYear };
        const result = await syncAMFIClassifications(classifications, period);

        revalidatePath('/dashboard');
        revalidatePath('/settings');

        const total = result.created + result.updated;
        return { 
            success: true, 
            message: `Successfully synced ${total} records for ${year} ${halfYear}.`,
            count: total
        };
    } catch (error) {
        console.error('[AMFI Upload Action] Error:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : 'An unexpected error occurred during upload.' 
        };
    }
}

/**
 * Delete AMFI classification data for a specific period
 */
export async function deleteAMFIPeriod(period: string): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
        const result = await prisma.aMFIClassification.deleteMany({
            where: { period },
        });

        revalidatePath('/dashboard');
        revalidatePath('/settings');

        return {
            success: true,
            message: `Deleted ${result.count} records for period ${period.replace('_', ' ')}.`,
        };
    } catch (error) {
        console.error('[AMFI Delete] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete AMFI data.',
        };
    }
}
