package main

import (
	"testing"

	"github.com/Podiom/Podiom/internal/store"
)

func TestAggregateTokenUsage(t *testing.T) {
	sessions := []store.Session{
		{
			AgentName: "alice",
			Model:     "model-small",
			Usage: store.SessionUsage{
				InputTokens:      100,
				OutputTokens:     50,
				CacheReadTokens:  10,
				CacheWriteTokens: 5,
			},
		},
		{
			AgentName: "alice",
			Model:     "model-large",
			Usage: store.SessionUsage{
				InputTokens:      200,
				OutputTokens:     20,
				CacheReadTokens:  15,
				CacheWriteTokens: 10,
			},
		},
		{
			AgentName: "bob",
			Model:     "model-large",
			Usage: store.SessionUsage{
				InputTokens:      300,
				OutputTokens:     100,
				CacheReadTokens:  20,
				CacheWriteTokens: 30,
			},
		},
		{
			Model: "default",
			Usage: store.SessionUsage{
				InputTokens:     10,
				OutputTokens:    5,
				CacheReadTokens: 1,
			},
		},
	}

	got := aggregateTokenUsage(sessions)
	wantTotal := store.SessionUsage{
		InputTokens:      610,
		OutputTokens:     175,
		CacheReadTokens:  46,
		CacheWriteTokens: 45,
	}
	if got.TotalSessions != len(sessions) {
		t.Errorf("TotalSessions = %d, want %d", got.TotalSessions, len(sessions))
	}
	if got.Total != wantTotal {
		t.Errorf("Total = %+v, want %+v", got.Total, wantTotal)
	}
	if len(got.ByAgent) != 3 {
		t.Fatalf("len(ByAgent) = %d, want 3", len(got.ByAgent))
	}

	wantAgents := []AgentTokenStats{
		{
			Agent:    "bob",
			Sessions: 1,
			Usage: store.SessionUsage{
				InputTokens:      300,
				OutputTokens:     100,
				CacheReadTokens:  20,
				CacheWriteTokens: 30,
			},
		},
		{
			Agent:    "alice",
			Sessions: 2,
			Usage: store.SessionUsage{
				InputTokens:      300,
				OutputTokens:     70,
				CacheReadTokens:  25,
				CacheWriteTokens: 15,
			},
		},
		{
			Agent:    "(none)",
			Sessions: 1,
			Usage: store.SessionUsage{
				InputTokens:     10,
				OutputTokens:    5,
				CacheReadTokens: 1,
			},
		},
	}
	for i, want := range wantAgents {
		if got.ByAgent[i] != want {
			t.Errorf("ByAgent[%d] = %+v, want %+v", i, got.ByAgent[i], want)
		}
	}
}

func TestAggregateByModel(t *testing.T) {
	sessions := []store.Session{
		{
			Model: "model-small",
			Usage: store.SessionUsage{InputTokens: 100, OutputTokens: 50, CacheReadTokens: 10, CacheWriteTokens: 5},
		},
		{
			Model: "model-large",
			Usage: store.SessionUsage{InputTokens: 200, OutputTokens: 20, CacheReadTokens: 15, CacheWriteTokens: 10},
		},
		{
			Model: "model-large",
			Usage: store.SessionUsage{InputTokens: 300, OutputTokens: 100, CacheReadTokens: 20, CacheWriteTokens: 30},
		},
		{
			Usage: store.SessionUsage{InputTokens: 10, OutputTokens: 5, CacheReadTokens: 1},
		},
	}

	got := aggregateByModel(sessions)
	want := []ModelTokenStats{
		{Model: "model-large", Total: 695},
		{Model: "model-small", Total: 165},
		{Model: "(default)", Total: 16},
	}
	if len(got) != len(want) {
		t.Fatalf("len(models) = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("models[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestFormatTokenCount(t *testing.T) {
	tests := []struct {
		name string
		n    int64
		want string
	}{
		{name: "zero", n: 0, want: "0"},
		{name: "below thousand", n: 999, want: "999"},
		{name: "thousand", n: 1_000, want: "1.0K"},
		{name: "rounds to thousand K", n: 999_999, want: "1000.0K"},
		{name: "million", n: 1_000_000, want: "1.0M"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatTokenCount(tt.n); got != tt.want {
				t.Errorf("formatTokenCount(%d) = %q, want %q", tt.n, got, tt.want)
			}
		})
	}
}
