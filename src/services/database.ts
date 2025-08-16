import Dexie, { Table } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import systemPrompts from '@/data/systemPrompts';
import {
    Story,
    Chapter,
    AIChat,
    Prompt,
    AISettings,
    LorebookEntry,
    SceneBeat,
    Note,
} from '../types/story';

export class StoryDatabase extends Dexie {
    stories!: Table<Story>;
    chapters!: Table<Chapter>;
    aiChats!: Table<AIChat>;
    prompts!: Table<Prompt>;
    aiSettings!: Table<AISettings>;
    lorebookEntries!: Table<LorebookEntry>;
    sceneBeats!: Table<SceneBeat>;
    notes!: Table<Note>;
    private _meta!: Table<{ id: string; value: any }>;

    constructor() {
        super('StoryDatabase', { addons: [dexieCloud] });

        this.version(12).stores({
            stories: 'id, title, createdAt, language, isDemo',
            chapters: 'id, storyId, order, createdAt, isDemo',
            aiChats: 'id, storyId, createdAt, isDemo',
            prompts: 'id, name, promptType, storyId, createdAt, isSystem',
            aiSettings: 'id, lastModelsFetch',
            lorebookEntries: 'id, storyId, name, category, *tags, isDemo',
            sceneBeats: 'id, storyId, chapterId',
            notes: 'id, storyId, title, type, createdAt, updatedAt',
            _meta: '&id',
        });

        this.cloud.configure({
            databaseUrl: 'https://z1eenxpyu.dexie.cloud',
            requireAuth: true, // optional
        });
    }

    async initializeDefaultData(): Promise<void> {
        // Use a transaction to ensure the check and the seeding happen atomically.
        await this.transaction('rw', this._meta, this.prompts, async () => {
            const isSeeded = await this._meta.get('systemPromptsSeeded');

            if (isSeeded) {
                // The flag exists, so the data has already been added. Do nothing.
                console.log('Default prompts already exist. Skipping seed.');
                return;
            }

            console.log('Seeding database with default system prompts...');

            // 1. Add the system prompts from your local data file.
            for (const promptData of systemPrompts) {
                await this.prompts.add({
                    ...promptData,
                    createdAt: new Date(),
                    isSystem: true,
                } as Prompt);
            }

            // 2. Set the flag in the metadata table to prevent this code from ever running again.
            await this._meta.put({ id: 'systemPromptsSeeded', value: true });

            console.log('Successfully seeded default prompts to the cloud.');
        });
    }

    // Helper method to create a new story with initial structure
    async createNewStory(storyData: Omit<Story, 'createdAt'>): Promise<string> {
        return await this.transaction('rw', [this.stories], async () => {
            const storyId = storyData.id || crypto.randomUUID();

            // Create the story
            await this.stories.add({
                id: storyId,
                createdAt: new Date(),
                ...storyData,
            });

            return storyId;
        });
    }

    // Helper method to get complete story structure
    async getFullStory(storyId: string) {
        const story = await this.stories.get(storyId);
        if (!story) return null;

        const chapters = await this.chapters
            .where('storyId')
            .equals(storyId)
            .sortBy('order');

        return {
            ...story,
            chapters,
        };
    }

    // Add helper method for lorebook entries
    async getLorebookEntriesByStory(storyId: string) {
        return await this.lorebookEntries
            .where('storyId')
            .equals(storyId)
            .toArray();
    }

    async getLorebookEntriesByTag(storyId: string, tag: string) {
        return await this.lorebookEntries
            .where(['storyId', 'tags'])
            .equals([storyId, tag])
            .toArray();
    }

    async getLorebookEntriesByCategory(
        storyId: string,
        category: LorebookEntry['category']
    ) {
        return await this.lorebookEntries
            .where(['storyId', 'category'])
            .equals([storyId, category])
            .toArray();
    }

    // Helper methods for SceneBeats
    async getSceneBeatsByChapter(chapterId: string): Promise<SceneBeat[]> {
        return this.sceneBeats.where('chapterId').equals(chapterId).toArray();
    }

    async getSceneBeat(id: string): Promise<SceneBeat | undefined> {
        return this.sceneBeats.get(id);
    }

    async createSceneBeat(
        data: Omit<SceneBeat, 'id' | 'createdAt'>
    ): Promise<string> {
        const id = crypto.randomUUID();
        await this.sceneBeats.add({
            id,
            createdAt: new Date(),
            ...data,
        } as SceneBeat);
        return id;
    }

    async updateSceneBeat(id: string, data: Partial<SceneBeat>): Promise<void> {
        await this.sceneBeats.update(id, data);
    }

    async deleteSceneBeat(id: string): Promise<void> {
        await this.sceneBeats.delete(id);
    }

    /**
     * Deletes a story and all related data (chapters, lorebook entries, etc.)
     * @param storyId The ID of the story to delete
     * @returns Promise that resolves when the deletion is complete
     */
    async deleteStoryWithRelated(storyId: string): Promise<void> {
        return await this.transaction(
            'rw',
            [
                this.stories,
                this.chapters,
                this.lorebookEntries,
                this.aiChats,
                this.sceneBeats,
            ],
            async () => {
                // Delete all related chapters
                await this.chapters.where('storyId').equals(storyId).delete();

                // Delete all related lorebook entries
                await this.lorebookEntries
                    .where('storyId')
                    .equals(storyId)
                    .delete();

                // Delete all related AI chats
                await this.aiChats.where('storyId').equals(storyId).delete();

                // Delete all related SceneBeats
                await this.sceneBeats.where('storyId').equals(storyId).delete();

                // Finally delete the story itself
                await this.stories.delete(storyId);

                console.log(`Deleted story ${storyId} and all related data`);
            }
        );
    }
}

export const db = new StoryDatabase();

// db.initializeDefaultData().catch((error) => {
//     console.error('Failed to initialize default database data:', error);
// });
