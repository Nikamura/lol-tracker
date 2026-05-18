import type { FC } from "hono/jsx";
import type { IngestStateRow, Player } from "../../db/queries.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "../components/ui.js";

function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return "never";
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export interface PlayersProps {
  rows: Array<{
    player: Player;
    state: IngestStateRow | undefined;
    lastPlayedAt: number | null;
  }>;
}

export const PlayersPage: FC<PlayersProps> = ({ rows }) => (
  <Card>
    <CardHeader>
      <CardTitle>Tracked players</CardTitle>
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <Empty
          title="No players yet"
          description="Run `pnpm dev add <gameName#tagLine> --platform <p>` to start tracking."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Display name</TH>
              <TH>Riot ID</TH>
              <TH>Platform</TH>
              <TH>Last polled</TH>
              <TH>Last match</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map(({ player, state, lastPlayedAt }) => (
              <TR>
                <TD class="font-medium">
                  <a
                    href={`/players/${player.puuid}`}
                    class="hover:text-primary hover:underline"
                  >
                    {player.displayName ?? player.gameName}
                  </a>
                </TD>
                <TD class="text-muted-foreground tabular-nums">
                  {player.gameName}#{player.tagLine}
                </TD>
                <TD class="text-muted-foreground uppercase">{player.platform}</TD>
                <TD class="text-muted-foreground">{fmtAgo(state?.lastPolledAt)}</TD>
                <TD class="text-muted-foreground">{fmtAgo(lastPlayedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </CardContent>
  </Card>
);
