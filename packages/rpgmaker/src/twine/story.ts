import { decodeText } from '../mvmz';
import { StoryContainer, parseStoryHtml, parseTwee } from './container';

export const isTweePath = (path: string) => /\.tw(ee)?$/i.test(path);

export function readStory(path: string, bytes: Uint8Array): { story: StoryContainer; text: string; bom: boolean } {
  const { text, bom } = decodeText(bytes);
  return { story: isTweePath(path) ? parseTwee(text) : parseStoryHtml(text), text, bom };
}
