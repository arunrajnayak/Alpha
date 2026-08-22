
import SettingsClient from './SettingsClient';
import CorporateActionsCard from './CorporateActionsCard';
import SymbolMappingsCard from './SymbolMappingsCard';
import AMFICard from './AMFICard';
import DividendsCard from './DividendsCard';
import { getDataLockDate, isUpstoxAnalyticsTokenConfigured } from '@/app/actions/settings';
import { getCorporateActions } from '@/app/actions';
import { getSymbolMappings } from '@/app/actions/symbol-mappings';
import { getDataFreshness } from '@/app/actions/screener';
import { SettingsContainer, SettingsSection } from './SettingsLayout';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const [corporateActions, dataLockDate, symbolMappings, freshness, analyticsTokenConfigured] = await Promise.all([
        getCorporateActions(),
        getDataLockDate(),
        getSymbolMappings(),
        getDataFreshness(),
        isUpstoxAnalyticsTokenConfigured(),
    ]);

    return (
        <SettingsContainer>
            <SettingsClient
                initialDataLockDate={dataLockDate}
                freshness={freshness}
                initialAnalyticsTokenConfigured={analyticsTokenConfigured}
            />
            <SettingsSection>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <AMFICard />
                    <DividendsCard />
                    <SymbolMappingsCard initialMappings={symbolMappings} />
                    <CorporateActionsCard initialActions={corporateActions} />
                </div>
            </SettingsSection>
        </SettingsContainer>
    );
}
