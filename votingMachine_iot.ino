#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

// ── Pins ──────────────────────────────────────────────────────
const int ID_PINS[4]  = {2, 3, 4, 5};
const int REP_PINS[4] = {6, 7, 8, 9};
const int BTN_VOTE    = 10;
const int BTN_FINISH  = 11;
const int BTN_RESET   = 12;
const int BUZZER      = 13;

// ── State ─────────────────────────────────────────────────────
bool voted[10] = {false,false,false,false,false,false,false,false,false,false};
int  votes[4]  = {0, 0, 0, 0};
bool finished  = false;

// ── Forward Declarations ──────────────────────────────────────
void doReset();
void showLive();
void broadcastData(const char* status);
void waitRelease(int pin);

// ═════════════════════════════════════════════════════════════
//  BUZZER PATTERNS
//  errorBeep()   — 2 short beeps: invalid/error input
//  warningBeep() — 1 long beep : already voted / ID=0
//  successBeep() — 1 short high: valid vote confirmed
// ═════════════════════════════════════════════════════════════
void errorBeep() {
  // Two short sharp beeps → invalid ID, no rep selected, multi-rep
  tone(BUZZER, 800, 150);  delay(200);
  tone(BUZZER, 800, 150);  delay(200);
  noTone(BUZZER);
}

void warningBeep() {
  // One long lower beep → already voted, ID=0 (unset voter card)
  tone(BUZZER, 500, 600);
  delay(650);
  noTone(BUZZER);
}

void successBeep() {
  // One short high beep → vote accepted
  tone(BUZZER, 1200, 100);
  delay(120);
  noTone(BUZZER);
}

// ═════════════════════════════════════════════════════════════
//  broadcastData()
// ═════════════════════════════════════════════════════════════
void broadcastData(const char* status) {
  Serial.print(F("DATA|"));
  Serial.print(F("R1:")); Serial.print(votes[0]); Serial.print(F(","));
  Serial.print(F("R2:")); Serial.print(votes[1]); Serial.print(F(","));
  Serial.print(F("R3:")); Serial.print(votes[2]); Serial.print(F(","));
  Serial.print(F("R4:")); Serial.print(votes[3]);
  Serial.print(F("|STATUS:"));
  Serial.println(status);
}

// ═════════════════════════════════════════════════════════════
//  waitOrReset()
// ═════════════════════════════════════════════════════════════
bool waitOrReset(unsigned long duration) {
  unsigned long start = millis();
  while (millis() - start < duration) {
    if (digitalRead(BTN_RESET) == HIGH) {
      delay(50);
      if (digitalRead(BTN_RESET) == HIGH) {
        doReset();
        waitRelease(BTN_RESET);
        return true;
      }
    }
  }
  return false;
}

// ═════════════════════════════════════════════════════════════
//  SETUP
// ═════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(9600);

  for (int i = 0; i < 4; i++) {
    pinMode(ID_PINS[i],  INPUT);
    pinMode(REP_PINS[i], INPUT);
  }
  pinMode(BTN_VOTE,   INPUT);
  pinMode(BTN_FINISH, INPUT);
  pinMode(BTN_RESET,  INPUT);
  pinMode(BUZZER,     OUTPUT);
  digitalWrite(BUZZER, LOW);

  lcd.init();
  lcd.backlight();

  doReset();
}

// ═════════════════════════════════════════════════════════════
//  MAIN LOOP
// ═════════════════════════════════════════════════════════════
void loop() {

  // ── RESET — highest priority ───────────────────────────────
  if (digitalRead(BTN_RESET) == HIGH) {
    delay(50);
    if (digitalRead(BTN_RESET) == HIGH) {
      doReset();
      waitRelease(BTN_RESET);
    }
    return;
  }

  // ── EDGE CASE [9]: VOTE pressed after election closed ─────
  if (finished) {
    if (digitalRead(BTN_VOTE) == HIGH) {
      delay(50);
      if (digitalRead(BTN_VOTE) == HIGH) {
        errorBeep();
        lcd.clear();
        lcd.setCursor(0, 0); lcd.print(F(" Voting  Closed!"));
        lcd.setCursor(0, 1); lcd.print(F(" Press  Reset.. "));
        waitRelease(BTN_VOTE);
        waitOrReset(2500);
      }
    }
    return;
  }

  // ── FINISH ────────────────────────────────────────────────
  if (digitalRead(BTN_FINISH) == HIGH) {
    delay(50);
    if (digitalRead(BTN_FINISH) == HIGH) {
      finished = true;
      broadcastData("Closed");
      showResults();
      waitRelease(BTN_FINISH);
    }
    return;
  }

  // ── VOTE ──────────────────────────────────────────────────
  if (digitalRead(BTN_VOTE) == HIGH) {
    delay(50);
    if (digitalRead(BTN_VOTE) == HIGH) {
      castVote();
      waitRelease(BTN_VOTE);
    }
  }
}

// ─────────────────────────────────────────────────────────────
void waitRelease(int pin) {
  while (digitalRead(pin) == HIGH) delay(10);
  delay(60);
}

// ─────────────────────────────────────────────────────────────
int sampleID() {
  int id = 0;
  if (digitalRead(2) == HIGH) id |= 1;
  if (digitalRead(3) == HIGH) id |= 2;
  if (digitalRead(4) == HIGH) id |= 4;
  if (digitalRead(5) == HIGH) id |= 8;
  return id;
}

int readID() {
  int a = sampleID(); delay(3);
  int b = sampleID(); delay(3);
  int c = sampleID();
  if (a == b) return a;
  if (a == c) return a;
  if (b == c) return b;
  return a;
}

int readRep() {
  int sel = -1, count = 0;
  for (int i = 0; i < 4; i++) {
    if (digitalRead(REP_PINS[i]) == HIGH) { sel = i; count++; }
  }
  return (count == 1) ? sel : -1;
}

// ═════════════════════════════════════════════════════════════
//  castVote()
// ═════════════════════════════════════════════════════════════
void castVote() {
  int id  = readID();
  int rep = readRep();

  lcd.clear();

  // ── EDGE CASE [10]: ID = 0 means no voter card inserted ───
  if (id == 0) {
    errorBeep();
    lcd.setCursor(0, 0); lcd.print(F("  No Voter Card "));
    lcd.setCursor(0, 1); lcd.print(F(" Set your ID SW "));
    broadcastData("Voting");
    if (waitOrReset(2500)) return;
    showLive();
    return;
  }

  // ── EDGE CASE [6]: Invalid ID > 9 ─────────────────────────
  if (id > 9) {
    errorBeep();
    lcd.setCursor(0, 0); lcd.print(F("  Invalid  ID!  "));
    lcd.setCursor(0, 1); lcd.print(F("ID ")); printBin(id); lcd.print(F(" >1001  "));
    broadcastData("Voting");
    if (waitOrReset(2500)) return;
    showLive();
    return;
  }

  // ── EDGE CASE [7]: Already voted ──────────────────────────
  if (voted[id]) {
    warningBeep();
    lcd.setCursor(0, 0); lcd.print(F(" Already Voted! "));
    lcd.setCursor(0, 1); lcd.print(F("ID:")); printBin(id); lcd.print(F(" used   "));
    broadcastData("Voting");
    if (waitOrReset(2500)) return;
    showLive();
    return;
  }

  // ── EDGE CASE [8]: No rep or multiple reps selected ───────
  if (rep == -1) {
    errorBeep();
    lcd.setCursor(0, 0); lcd.print(F("Pick ONLY 1 Rep!"));
    lcd.setCursor(0, 1); lcd.print(F("Then press VOTE "));
    broadcastData("Voting");
    if (waitOrReset(2500)) return;
    showLive();
    return;
  }

  // ── Valid vote ────────────────────────────────────────────
  votes[rep]++;
  voted[id] = true;

  successBeep();

  lcd.setCursor(0, 0); lcd.print(F("  Vote  Cast!   "));
  lcd.setCursor(0, 1);
  lcd.print(F("R")); lcd.print(rep + 1);
  lcd.print(F(" | ID:")); printBin(id); lcd.print(F("  "));

  broadcastData("Voting");

  if (waitOrReset(2000)) return;
  showLive();
}

// ─────────────────────────────────────────────────────────────
void showLive() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(F("R1:")); lcd.print(votes[0]);
  lcd.print(F("    R2:")); lcd.print(votes[1]);
  lcd.setCursor(0, 1);
  lcd.print(F("R3:")); lcd.print(votes[2]);
  lcd.print(F("    R4:")); lcd.print(votes[3]);
}

// ═════════════════════════════════════════════════════════════
//  showResults()
// ═════════════════════════════════════════════════════════════
void showResults() {

  int maxVotes = 0;
  for (int i = 0; i < 4; i++)
    if (votes[i] > maxVotes) maxVotes = votes[i];

  // EDGE CASE 1: No votes cast
  if (maxVotes == 0) {
    warningBeep();
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print(F(" No Votes Cast! "));
    lcd.setCursor(0, 1); lcd.print(F(" Press Reset..  "));
    broadcastData("Closed");
    return;
  }

  int order[4] = {0, 1, 2, 3};
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3 - i; j++)
      if (votes[order[j]] < votes[order[j+1]]) {
        int tmp = order[j]; order[j] = order[j+1]; order[j+1] = tmp;
      }

  int firstTieCount = 0;
  for (int i = 0; i < 4; i++)
    if (votes[i] == maxVotes) firstTieCount++;

  // EDGE CASE 2: Tie for 1st
  if (firstTieCount >= 2) {
    warningBeep();
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print(F("   *** TIE ***  "));
    lcd.setCursor(0, 1);
    for (int i = 0; i < 4; i++) {
      if (votes[i] == maxVotes) {
        lcd.print(F("R")); lcd.print(i + 1); lcd.print(F(" "));
      }
    }
    lcd.print(maxVotes); lcd.print(F("v"));
    broadcastData("Closed");
    if (waitOrReset(4000)) return;
    showLive();
    return;
  }

  // Normal: single winner
  successBeep();
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(F("  * WINNER *    "));
  lcd.setCursor(0, 1);
  lcd.print(F("  R")); lcd.print(order[0]+1);
  lcd.print(F(" : ")); lcd.print(votes[order[0]]); lcd.print(F(" votes"));
  broadcastData("Closed");
  if (waitOrReset(4000)) return;

  int secondVotes = votes[order[1]];

  // EDGE CASE 3: No runner-up
  if (secondVotes == 0) {
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print(F("* No Runner-up *"));
    lcd.setCursor(0, 1); lcd.print(F(" Others: 0 votes"));
    if (waitOrReset(3000)) return;
    showLive();
    return;
  }

  int ruTieCount = 0;
  for (int i = 0; i < 4; i++)
    if (votes[i] == secondVotes) ruTieCount++;

  // EDGE CASE 4: Tie for runner-up
  if (ruTieCount >= 2) {
    warningBeep();
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print(F(" RUNNER-UP TIE  "));
    lcd.setCursor(0, 1);
    for (int i = 0; i < 4; i++) {
      if (votes[i] == secondVotes) {
        lcd.print(F("R")); lcd.print(i + 1); lcd.print(F(" "));
      }
    }
    lcd.print(secondVotes); lcd.print(F("v"));
    if (waitOrReset(3000)) return;
    showLive();
    return;
  }

  // Normal: single runner-up
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(F(" * RUNNER-UP *  "));
  lcd.setCursor(0, 1);
  lcd.print(F("  R")); lcd.print(order[1]+1);
  lcd.print(F(" : ")); lcd.print(votes[order[1]]); lcd.print(F(" votes"));
  if (waitOrReset(4000)) return;

  showLive();
}

// ─────────────────────────────────────────────────────────────
void doReset() {
  noTone(BUZZER);
  finished = false;
  for (int i = 0; i < 10; i++) voted[i] = false;
  for (int i = 0; i < 4;  i++) votes[i] = 0;

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(F(" Voting Machine "));
  lcd.setCursor(0, 1); lcd.print(F("    Ready!      "));

  broadcastData("Ready");
  delay(1500);
  showLive();
  broadcastData("Voting");
}

// ─────────────────────────────────────────────────────────────
void printBin(int val) {
  for (int b = 3; b >= 0; b--) lcd.print((val >> b) & 1);
}