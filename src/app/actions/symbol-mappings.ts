'use server';

import { prisma } from '@/lib/db';

export interface SymbolMappingDisplay {
    id: number;
    oldSymbol: string;
    newSymbol: string;
    createdAt: Date;
}

/**
 * Get all symbol mappings from the database
 */
export async function getSymbolMappings(): Promise<SymbolMappingDisplay[]> {
    const mappings = await prisma.symbolMapping.findMany({
        orderBy: { createdAt: 'desc' }
    });
    
    return mappings.map(m => ({
        id: m.id,
        oldSymbol: m.oldSymbol,
        newSymbol: m.newSymbol,
        createdAt: m.createdAt
    }));
}

/**
 * Add a new symbol mapping
 */
export async function addSymbolMapping(oldSymbol: string, newSymbol: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Normalize symbols
        const normalizedOld = oldSymbol.toUpperCase().trim();
        const normalizedNew = newSymbol.toUpperCase().trim();
        
        if (!normalizedOld || !normalizedNew) {
            return { success: false, error: 'Both old and new symbols are required' };
        }
        
        if (normalizedOld === normalizedNew) {
            return { success: false, error: 'Old and new symbols cannot be the same' };
        }
        
        // Check if mapping already exists
        const existing = await prisma.symbolMapping.findUnique({
            where: { oldSymbol: normalizedOld }
        });
        
        if (existing) {
            return { success: false, error: `Mapping for ${normalizedOld} already exists (→ ${existing.newSymbol})` };
        }
        
        await prisma.symbolMapping.create({
            data: {
                oldSymbol: normalizedOld,
                newSymbol: normalizedNew
            }
        });
        
        return { success: true };
    } catch (error) {
        console.error('Error adding symbol mapping:', error);
        return { success: false, error: 'Failed to add symbol mapping' };
    }
}

/**
 * Delete a symbol mapping
 */
export async function deleteSymbolMapping(id: number): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.symbolMapping.delete({
            where: { id }
        });
        return { success: true };
    } catch (error) {
        console.error('Error deleting symbol mapping:', error);
        return { success: false, error: 'Failed to delete symbol mapping' };
    }
}
