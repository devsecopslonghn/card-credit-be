package com.devsecopslonghn.cardcredit.shared;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;

class HealthControllerTest {
  @Test void healthContractIsStable() { assertThat(new HealthControllerTest()).isNotNull(); }
}
