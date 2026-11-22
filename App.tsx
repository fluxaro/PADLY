import React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ControllerScreen from './src/screens/ControllerScreen';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <ControllerScreen />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
