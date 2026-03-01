
import SettingsClient from './SettingsClient';
import CorporateActionsCard from './CorporateActionsCard';
import SymbolMappingsCard from './SymbolMappingsCard';
import AMFICard from './AMFICard';
import { getDataLockDate } from '@/app/actions/settings';
import { getCorporateActions } from '@/app/actions';
import { getSymbolMappings } from '@/app/actions/symbol-mappings';
import { SettingsContainer, SettingsSection } from './SettingsLayout';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
    const [corporateActions, dataLockDate, symbolMappings] = await Promise.all([
        getCorporateActions(),
        getDataLockDate(),
        getSymbolMappings()
    ]);

    return (
        <SettingsContainer>
            <SettingsClient initialDataLockDate={dataLockDate} />
            <SettingsSection>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <AMFICard />
                    <SymbolMappingsCard initialMappings={symbolMappings} />
                    <CorporateActionsCard initialActions={corporateActions} />
                </div>
            </SettingsSection>
        </SettingsContainer>
    );
}
